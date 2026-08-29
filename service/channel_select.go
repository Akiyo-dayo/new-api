package service

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
)

type RetryParam struct {
	Ctx          *gin.Context
	TokenGroup   string
	ModelName    string
	RequestPath  string
	Retry        *int
	resetNextTry bool
}

func (p *RetryParam) GetRetry() int {
	if p.Retry == nil {
		return 0
	}
	return *p.Retry
}

func (p *RetryParam) SetRetry(retry int) {
	p.Retry = &retry
}

func (p *RetryParam) IncreaseRetry() {
	if p.resetNextTry {
		p.resetNextTry = false
		return
	}
	if p.Retry == nil {
		p.Retry = new(int)
	}
	*p.Retry++
}

func (p *RetryParam) ResetRetryNextTry() {
	p.resetNextTry = true
}

// CacheGetRandomSatisfiedChannel tries to get a random channel that satisfies the requirements.
// 尝试获取一个满足要求的随机渠道。
//
// tokenGroup 有三种形态：
//
//   - "ratio:<下界>-<上界>"：倍率区间令牌，一个令牌对应区间内的多个分组，
//     按「最低价优先、同价轮询」选路，见 selectRatioRangeChannel。
//   - "auto"：按 auto_groups 的配置顺序逐个回退（不是轮询）。
//   - 其他：一个具体分组。
//
// 前两种都是伪分组：token.Group 里存的不是真实分组名，真正用于计费的分组在选路定下来
// 之后通过 constant.ContextKeyAutoGroup 下发，由 relay/helper.HandleGroupRatio 取用。
//
// For "auto" tokenGroup with cross-group Retry enabled:
// 对于启用了跨分组重试的 "auto" tokenGroup：
//
//   - Each group will exhaust all its priorities before moving to the next group.
//     每个分组会用完所有优先级后才会切换到下一个分组。
//
//   - Uses ContextKeyAutoGroupIndex to track current group index.
//     使用 ContextKeyAutoGroupIndex 跟踪当前分组索引。
//
//   - Uses ContextKeyAutoGroupRetryIndex to track the global Retry count when current group started.
//     使用 ContextKeyAutoGroupRetryIndex 跟踪当前分组开始时的全局重试次数。
//
//   - priorityRetry = Retry - startRetryIndex, represents the priority level within current group.
//     priorityRetry = Retry - startRetryIndex，表示当前分组内的优先级级别。
//
//   - When GetRandomSatisfiedChannel returns nil (priorities exhausted), moves to next group.
//     当 GetRandomSatisfiedChannel 返回 nil（优先级用完）时，切换到下一个分组。
//
// Example flow (2 groups, each with 2 priorities, RetryTimes=3):
// 示例流程（2个分组，每个有2个优先级，RetryTimes=3）：
//
//	Retry=0: GroupA, priority0 (startRetryIndex=0, priorityRetry=0)
//	         分组A, 优先级0
//
//	Retry=1: GroupA, priority1 (startRetryIndex=0, priorityRetry=1)
//	         分组A, 优先级1
//
//	Retry=2: GroupA exhausted → GroupB, priority0 (startRetryIndex=2, priorityRetry=0)
//	         分组A用完 → 分组B, 优先级0
//
//	Retry=3: GroupB, priority1 (startRetryIndex=2, priorityRetry=1)
//	         分组B, 优先级1
func CacheGetRandomSatisfiedChannel(param *RetryParam) (*model.Channel, string, error) {
	var channel *model.Channel
	var err error
	selectGroup := param.TokenGroup
	userGroup := common.GetContextKeyString(param.Ctx, constant.ContextKeyUserGroup)

	if ratioRange, isRatioRange, rangeErr := ratio_setting.ParseTokenGroupRatioRange(param.TokenGroup); isRatioRange {
		if rangeErr != nil {
			return nil, selectGroup, rangeErr
		}
		return selectRatioRangeChannel(param, ratioRange, userGroup)
	}

	if param.TokenGroup == "auto" {
		if len(setting.GetAutoGroups()) == 0 {
			return nil, selectGroup, errors.New("auto groups is not enabled")
		}
		autoGroups := GetUserAutoGroup(userGroup)

		// startGroupIndex: the group index to start searching from
		// startGroupIndex: 开始搜索的分组索引
		startGroupIndex := 0
		crossGroupRetry := common.GetContextKeyBool(param.Ctx, constant.ContextKeyTokenCrossGroupRetry)

		if lastGroupIndex, exists := common.GetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex); exists {
			if idx, ok := lastGroupIndex.(int); ok {
				startGroupIndex = idx
			}
		}

		if hit, hitGroup := selectGroupSequence(param, autoGroups, startGroupIndex, crossGroupRetry); hit != nil {
			channel = hit
			selectGroup = hitGroup
		}
	} else {
		channel, err = model.GetRandomSatisfiedChannel(param.TokenGroup, param.ModelName, param.GetRetry(), param.RequestPath)
		if err != nil {
			return nil, param.TokenGroup, err
		}
	}
	return channel, selectGroup, nil
}

// selectRatioRangeChannel 处理 ratio:<下界>-<上界> 这种倍率区间令牌。
//
// 语义是「最低价优先，同价轮询」：候选分组按用户实际生效的倍率从低到高分层，先在最便宜
// 那一层的分组之间轮询；该层没有这个模型的可用渠道、或调用失败降级过来，才走下一层。
// 区间的含义是「我最多接受到这个价」，所以用户永远拿到区间内当下能拿到的最低价。
//
// 区间内没有可用分组、或没有该模型的可用渠道时一律返回错误，绝不静默退回用户自己的分组：
// 那会让用户在不知情的情况下按区间外的倍率被计费。
func selectRatioRangeChannel(param *RetryParam, ratioRange ratio_setting.RatioRange, userGroup string) (*model.Channel, string, error) {
	groups, cached := ratioRangeGroupOrderFromContext(param)
	if !cached {
		candidates := GetUserGroupsInRatioRange(userGroup, ratioRange)
		if len(candidates) == 0 {
			return nil, param.TokenGroup, fmt.Errorf("倍率区间 %s 内没有当前用户可用的分组", ratioRange)
		}

		// 先剔除没有该模型可用渠道的分组：轮询取模必须落在真会被命中的分组上，
		// 否则起点经常落到空分组再顺延，同价分组的命中次数会明显失衡。
		available := make([]UserGroupRatio, 0, len(candidates))
		for _, candidate := range candidates {
			if probe, _ := model.GetRandomSatisfiedChannel(candidate.Group, param.ModelName, 0, param.RequestPath); probe != nil {
				available = append(available, candidate)
			}
		}
		if len(available) == 0 {
			return nil, param.TokenGroup, fmt.Errorf("倍率区间 %s 内没有模型 %s 的可用渠道", ratioRange, param.ModelName)
		}

		groups = buildRatioRangeGroupOrder(param.ModelName, available)
		common.SetContextKey(param.Ctx, constant.ContextKeyRatioRangeGroups, groups)
	}

	startIndex := 0
	if lastGroupIndex, exists := common.GetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex); exists {
		if idx, ok := lastGroupIndex.(int); ok && idx > 0 {
			startIndex = idx
		}
	}

	// 区间令牌恒定允许跨分组重试：用户填区间时已经明确接受了区间内的任何价格，
	// 便宜的那层调不通却不让降级，等于把令牌的可用性砍到只剩最便宜的一层。
	channel, selectGroup := selectGroupSequence(param, groups, startIndex, true)
	if channel == nil {
		return nil, param.TokenGroup, fmt.Errorf("倍率区间 %s 内没有模型 %s 的可用渠道", ratioRange, param.ModelName)
	}
	return channel, selectGroup, nil
}

// ratioRangeGroupOrderFromContext 取回本次请求已经定好的分组尝试顺序。
// 顺序里含同价分组的轮询起点，重算一次就会再消费一次游标，一次请求把游标推进好几格，
// 同价分组之间就不再是均摊了，所以整条请求（含重试）必须复用同一份顺序。
func ratioRangeGroupOrderFromContext(param *RetryParam) ([]string, bool) {
	value, exists := common.GetContextKey(param.Ctx, constant.ContextKeyRatioRangeGroups)
	if !exists {
		return nil, false
	}
	groups, ok := value.([]string)
	if !ok || len(groups) == 0 {
		return nil, false
	}
	return groups, true
}

// buildRatioRangeGroupOrder 把候选分组排成本次请求的完整尝试顺序：价位从低到高，
// 同价位内从轮询游标给出的下标开始回绕一圈。
//
// candidates 必须已按倍率升序排好（GetUserGroupsInRatioRange 的输出即满足）。
func buildRatioRangeGroupOrder(modelName string, candidates []UserGroupRatio) []string {
	ordered := make([]string, 0, len(candidates))
	for start := 0; start < len(candidates); {
		end := start + 1
		for end < len(candidates) && candidates[end].Ratio == candidates[start].Ratio {
			end++
		}
		level := candidates[start:end]
		offset := nextGroupRotationIndex(modelName, level[0].Ratio, len(level))
		for i := range level {
			ordered = append(ordered, level[(offset+i)%len(level)].Group)
		}
		start = end
	}
	return ordered
}

// selectGroupSequence 按给定顺序在多个分组之间依次找可用渠道，并维护跨分组重试所需的
// ContextKeyAutoGroupIndex 顺延状态。命中时通过 ContextKeyAutoGroup 下发真正用于计费的
// 分组；走到列表末尾仍未命中则返回 (nil, "")。
//
// auto 分组和倍率区间令牌共用这套顺延：两者的差别只在「候选顺序怎么排」——auto 按
// AutoGroups 的配置顺序，区间令牌按价格分层加同价轮询。
func selectGroupSequence(param *RetryParam, groups []string, startIndex int, crossGroupRetry bool) (*model.Channel, string) {
	for i := startIndex; i < len(groups); i++ {
		group := groups[i]
		// Calculate priorityRetry for current group
		// 计算当前分组的 priorityRetry
		priorityRetry := param.GetRetry()
		// If moved to a new group, reset priorityRetry
		// 如果切换到新分组，重置 priorityRetry
		if i > startIndex {
			priorityRetry = 0
		}
		logger.LogDebug(param.Ctx, "Selecting group: %s, priorityRetry: %d", group, priorityRetry)

		channel, _ := model.GetRandomSatisfiedChannel(group, param.ModelName, priorityRetry, param.RequestPath)
		if channel == nil {
			// Current group has no available channel for this model, try next group
			// 当前分组没有该模型的可用渠道，尝试下一个分组
			logger.LogDebug(param.Ctx, "No available channel in group %s for model %s at priorityRetry %d, trying next group", group, param.ModelName, priorityRetry)
			// 重置状态以尝试下一个分组
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupRetryIndex, 0)
			// Reset retry counter so outer loop can continue for next group
			// 重置重试计数器，以便外层循环可以为下一个分组继续
			param.SetRetry(0)
			continue
		}
		common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroup, group)
		logger.LogDebug(param.Ctx, "Selected group: %s", group)

		// Prepare state for next retry
		// 为下一次重试准备状态
		if crossGroupRetry && priorityRetry >= common.RetryTimes {
			// Current group has exhausted all retries, prepare to switch to next group
			// This request still uses current group, but next retry will use next group
			// 当前分组已用完所有重试次数，准备切换到下一个分组
			// 本次请求仍使用当前分组，但下次重试将使用下一个分组
			logger.LogDebug(param.Ctx, "Current group %s retries exhausted (priorityRetry=%d >= RetryTimes=%d), preparing switch to next group for next retry", group, priorityRetry, common.RetryTimes)
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i+1)
			// Reset retry counter so outer loop can continue for next group
			// 重置重试计数器，以便外层循环可以为下一个分组继续
			param.SetRetry(0)
			param.ResetRetryNextTry()
		} else {
			// Stay in current group, save current state
			// 保持在当前分组，保存当前状态
			common.SetContextKey(param.Ctx, constant.ContextKeyAutoGroupIndex, i)
		}
		return channel, group
	}
	return nil, ""
}

// ResolveChannelBillingGroup 把 auto / ratio:<下界>-<上界> 这种伪分组回推成一个真实分组。
//
// 伪分组不是 GroupRatio 里的键，拿它去查倍率必然未命中而回落到 1.0（原价），所以每一条
// **绕过选路直接定住渠道**的入口（渠道亲和命中、sk-<key>-<渠道ID> 管理员定向）都必须先过
// 这一步，否则用户会按原价被扣费，日志里的分组列也会记成伪分组名。
//
// 候选按倍率升序，取第一个真正挂了该渠道与该模型的分组——与选路时「最低价优先」同序。
// 注意这只保证在**该渠道所属的分组里**取最便宜的那个，拦不住渠道本身就落在贵价位上：
// 区间令牌那条「不能比当下最低可用价更贵」的守卫在 AffinityKeepsLowestAvailablePrice。
//
// 三种返回：
//   - ("", false, nil)     usingGroup 不是伪分组，调用方按原样使用它
//   - (group, true, nil)   回推成功
//   - ("", true, err)      是伪分组但回推不出真实分组，绝不能静默按 1.0 计费
func ResolveChannelBillingGroup(usingGroup, userGroup, modelName string, channelId int) (string, bool, error) {
	candidates := make([]string, 0)
	if ratioRange, isRatioRange, rangeErr := ratio_setting.ParseTokenGroupRatioRange(usingGroup); isRatioRange {
		if rangeErr != nil {
			return "", true, rangeErr
		}
		for _, candidate := range GetUserGroupsInRatioRange(userGroup, ratioRange) {
			candidates = append(candidates, candidate.Group)
		}
	} else if usingGroup == "auto" {
		candidates = GetUserAutoGroup(userGroup)
	} else {
		return "", false, nil
	}

	for _, group := range candidates {
		if model.IsChannelEnabledForGroupModel(group, modelName, channelId) {
			return group, true, nil
		}
	}
	return "", true, fmt.Errorf("分组 %s 展开后没有一个分组同时挂着渠道 #%d 与模型 %s，无法确定计费分组；请改用绑定具体分组的令牌", usingGroup, channelId, modelName)
}

// AffinityKeepsLowestAvailablePrice 判断渠道亲和钉住的这个渠道，会不会让倍率区间令牌
// 按比「当下能拿到的最低价」更贵的价位计费。返回 false 时调用方必须放弃亲和、退回选路。
//
// 为什么需要这一道：亲和缓存记的是**上次成功的那个渠道**（SwitchOnSuccess 默认开），
// 包括便宜层短暂不可用时降级过去的贵渠道。便宜层恢复后没有任何人重新比价，亲和会把用户
// 钉在贵价位上直到 TTL 到期（默认 3600 秒）。区间令牌承诺的是 selectRatioRangeChannel
// 声明的那条语义——「用户永远拿到区间内当下能拿到的最低价」，亲和不能把它推翻。
//
// 只对 ratio: 区间令牌生效。auto 的语义是**按配置顺序回退**而不是最低价优先，
// 对它比价会把 auto 的既有语义改掉；真实分组更没有「别的价位」可言，一律放行。
//
// 候选按倍率升序，遇到第一个不比亲和分组便宜的就收工：亲和分组本来就在最便宜那层时
// （最常见的情况）一次渠道探测都不做。只有确实存在更便宜的价位时才去探测它有没有可用
// 渠道，且探到第一个可用的就立刻返回 false——找到一个就足以说明亲和更贵。
func AffinityKeepsLowestAvailablePrice(usingGroup, userGroup, affinityGroup, modelName, requestPath string) bool {
	ratioRange, isRatioRange, rangeErr := ratio_setting.ParseTokenGroupRatioRange(usingGroup)
	if !isRatioRange || rangeErr != nil {
		return true
	}
	affinityRatio, ok := effectiveGroupRatio(userGroup, affinityGroup)
	if !ok {
		// 没配倍率的分组算不出价位，也就无从证明它不比别人贵。计费时它会回落到 1.0
		// 原价，正是这条守卫要拦的方向，所以放弃亲和交给选路（选路会把它过滤掉）。
		return false
	}
	for _, candidate := range GetUserGroupsInRatioRange(userGroup, ratioRange) {
		if candidate.Ratio >= affinityRatio {
			return true
		}
		if probe, _ := model.GetRandomSatisfiedChannel(candidate.Group, modelName, 0, requestPath); probe != nil {
			return false
		}
	}
	return true
}

// ResolveDirectedChannelBillingGroup 是 sk-<key>-<渠道ID> 管理员定向调用专用的回推。
//
// 定向分支在 middleware/distributor.go 里**整段跳过选路**，于是「这个分组到底挂没挂着这个
// 渠道」从来没有人验证过。伪分组交给 ResolveChannelBillingGroup 展开；**真实分组这里只做
// 一件事：核对，核不上就拒绝**。
//
// 为什么真实分组不像伪分组那样「回推成最便宜的候选」：伪分组令牌明确说了「区间内最低价
// 优先」，替它挑最便宜的就是它要的语义；而绑定具体分组的令牌说的是「按这个分组计费」，
// 渠道不在这个分组里时，**任何替它挑一个分组的做法都是猜**。曾经猜过一版「用户可用分组
// 里按倍率升序取第一个挂着该渠道的」，实测踩到：令牌绑 snow(0.18)、渠道恰好也挂在免费组
// 下，回推结果是 free —— 按 0 计费。方向还是少收，比它要修的那个 24% 更糟。
//
// 渠道亲和那条入口**不需要**这个函数：它对真实分组本来就有 IsChannelEnabledForGroupModel
// 的守卫，不满足时直接放弃亲和退回正常选路，不会错计费。
func ResolveDirectedChannelBillingGroup(usingGroup, userGroup, modelName string, channelId int) (string, bool, error) {
	// 一批请求根本不带模型名：MJ 的 task fetch / fetch-by-condition / notify、Suno 的 fetch、
	// /v1/videos/.../remix —— getModelRequest 对它们 shouldSelectChannel=false。
	// 它们不选路也不计费，这里必须完全不介入：IsChannelEnabledForGroupModel 对空模型名
	// 恒返回 false，一旦介入就会把「提交时钉住渠道、之后用同一把定向 key 取结果」这种
	// 正常用法整片挡成 403。
	if modelName == "" {
		return "", false, nil
	}
	group, override, err := ResolveChannelBillingGroup(usingGroup, userGroup, modelName, channelId)
	if override || err != nil {
		return group, override, err
	}
	if model.IsChannelEnabledForGroupModel(usingGroup, modelName, channelId) {
		return "", false, nil
	}
	return "", true, fmt.Errorf("渠道 #%d 不在分组 %s 下（模型 %s），无法按该分组计费；请改用一个确实挂着这个渠道的分组令牌，或先把渠道加进该分组", channelId, usingGroup, modelName)
}
