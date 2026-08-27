package service

import (
	"sort"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	perfmetrics "github.com/QuantumNous/new-api/pkg/perf_metrics"
)

// ModelSquareStat 是下发给模型广场的单模型统计，用于「按热门」「按成功率」排序。
//
// 数据来自 pkg/perf_metrics —— 站内已有的性能指标子系统，模型详情页的成功率/延迟/TPS
// 用的就是它。不另起一套按日志表聚合的口径：同一个产品里出现两个都叫「成功率」但算法
// 不同的数，迟早会有人拿它们对不上账。
//
// 刻意不下发原始调用次数：/api/pricing 是公开接口，逐模型的真实调用量属于经营数据。
// 排序需要的只是名次和成功率，这两个值不泄露量级。
type ModelSquareStat struct {
	// PopularityRank 1 = 最热门。统计窗口内没有任何请求的模型不会出现在结果里。
	PopularityRank int `json:"popularity_rank"`
	// SuccessRate 是 0~100 的成功率百分比，口径与模型详情页完全一致（perf_metrics
	// 直接给的就是百分比）。样本量不足时为 null，前端应显示「样本不足」而不是把它
	// 当成 0——把一个刚上线、只被调用过两次的模型排到成功率末位是误导。
	SuccessRate *float64 `json:"success_rate"`
}

const (
	// modelSquareStatsWindowHours 是统计窗口。7 天足够抹平单日抖动，又不会让一个月前
	// 已经下线的模型继续占着热门榜。
	modelSquareStatsWindowHours = 7 * 24
	// modelSquareStatsTTL 是快照的有效期。公开接口不能每次请求都去扫指标表。
	modelSquareStatsTTL = 10 * time.Minute
	// modelSquareStatsMinSamples 是给出成功率所需的最小请求数。
	modelSquareStatsMinSamples = 20
)

var (
	modelSquareStatsLock    sync.RWMutex
	modelSquareStatsCache   map[string]ModelSquareStat
	modelSquareStatsFetched time.Time
	// modelSquareStatsRefresh 保证同一时刻只有一个 goroutine 在算快照；
	// 抢不到的直接拿旧快照走人，不排队等。
	modelSquareStatsRefresh sync.Mutex
)

// GetModelSquareStats 返回模型广场的统计快照。返回的 map 只读，不要就地修改。
//
// 快照过期时由第一个进来的请求刷新，其余请求继续拿旧快照，不会堆在锁上。
// 查询失败时也返回旧快照：宁可让排序依据旧一点，也不要因为指标库抖动就让整个广场的
// 排序失效。
func GetModelSquareStats() map[string]ModelSquareStat {
	if cached, fresh := readModelSquareStats(); fresh {
		return cached
	}

	if !modelSquareStatsRefresh.TryLock() {
		cached, _ := readModelSquareStats()
		return cached
	}
	defer modelSquareStatsRefresh.Unlock()

	// 拿到刷新权后再看一次：等锁期间可能已经有人刷过了。
	if cached, fresh := readModelSquareStats(); fresh {
		return cached
	}

	// 传 nil = 不按分组过滤。热门回答的是「这个模型有多少人在用」，跟它当时走的是
	// 哪个分组无关；按当前分组过滤会让分组一改名，历史流量就整片消失，广场排序看起来
	// 像坏了。模型本身是否还在售由 /api/pricing 的模型列表决定，这里不用再管一次。
	summary, err := perfmetrics.QuerySummaryAll(modelSquareStatsWindowHours, nil)
	if err != nil {
		common.SysError("failed to load model square stats: " + err.Error())
		cached, _ := readModelSquareStats()
		return cached
	}

	built := buildModelSquareStats(summary.Models)
	modelSquareStatsLock.Lock()
	modelSquareStatsCache = built
	modelSquareStatsFetched = time.Now()
	modelSquareStatsLock.Unlock()
	return built
}

func readModelSquareStats() (map[string]ModelSquareStat, bool) {
	modelSquareStatsLock.RLock()
	defer modelSquareStatsLock.RUnlock()
	if modelSquareStatsCache == nil {
		return map[string]ModelSquareStat{}, false
	}
	return modelSquareStatsCache, time.Since(modelSquareStatsFetched) < modelSquareStatsTTL
}

// buildModelSquareStats 把性能指标换算成名次与成功率。
func buildModelSquareStats(models []perfmetrics.ModelSummary) map[string]ModelSquareStat {
	ordered := make([]perfmetrics.ModelSummary, 0, len(models))
	for _, item := range models {
		if item.ModelName == "" || item.RequestCount <= 0 {
			continue
		}
		ordered = append(ordered, item)
	}
	// 请求量相同时按模型名排序，保证名次稳定：名次每次刷新都抖一下，用户会觉得
	// 广场排序是随机的。
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].RequestCount != ordered[j].RequestCount {
			return ordered[i].RequestCount > ordered[j].RequestCount
		}
		return ordered[i].ModelName < ordered[j].ModelName
	})

	result := make(map[string]ModelSquareStat, len(ordered))
	for i, item := range ordered {
		entry := ModelSquareStat{PopularityRank: i + 1}
		if item.RequestCount >= modelSquareStatsMinSamples {
			rate := item.SuccessRate
			entry.SuccessRate = &rate
		}
		result[item.ModelName] = entry
	}
	return result
}

// ResetModelSquareStatsCache 丢弃快照，下次读取会重新计算。测试用。
func ResetModelSquareStatsCache() {
	modelSquareStatsLock.Lock()
	defer modelSquareStatsLock.Unlock()
	modelSquareStatsCache = nil
	modelSquareStatsFetched = time.Time{}
}
