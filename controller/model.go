package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	"github.com/QuantumNous/new-api/relay/channel/ai360"
	"github.com/QuantumNous/new-api/relay/channel/lingyiwanwu"
	"github.com/QuantumNous/new-api/relay/channel/minimax"
	"github.com/QuantumNous/new-api/relay/channel/moonshot"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
)

// https://platform.openai.com/docs/api-reference/models/list

var openAIModels []dto.OpenAIModels
var openAIModelsMap map[string]dto.OpenAIModels
var channelId2Models map[int][]string

func init() {
	// https://platform.openai.com/docs/models/model-endpoint-compatibility
	for i := 0; i < constant.APITypeDummy; i++ {
		if i == constant.APITypeAIProxyLibrary {
			continue
		}
		adaptor := relay.GetAdaptor(i)
		channelName := adaptor.GetChannelName()
		modelNames := adaptor.GetModelList()
		for _, modelName := range modelNames {
			openAIModels = append(openAIModels, dto.OpenAIModels{
				Id:      modelName,
				Object:  "model",
				Created: 1626777600,
				OwnedBy: channelName,
			})
		}
	}
	for _, modelName := range ai360.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: ai360.ChannelName,
		})
	}
	for _, modelName := range moonshot.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: moonshot.ChannelName,
		})
	}
	for _, modelName := range lingyiwanwu.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: lingyiwanwu.ChannelName,
		})
	}
	for _, modelName := range minimax.ModelList {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: minimax.ChannelName,
		})
	}
	for modelName, _ := range constant.MidjourneyModel2Action {
		openAIModels = append(openAIModels, dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: "midjourney",
		})
	}
	openAIModelsMap = make(map[string]dto.OpenAIModels)
	for _, aiModel := range openAIModels {
		openAIModelsMap[aiModel.Id] = aiModel
	}
	channelId2Models = make(map[int][]string)
	for i := 1; i <= constant.ChannelTypeDummy; i++ {
		apiType, success := common.ChannelType2APIType(i)
		if !success || apiType == constant.APITypeAIProxyLibrary {
			continue
		}
		meta := &relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType: i,
		}}
		adaptor := relay.GetAdaptor(apiType)
		adaptor.Init(meta)
		channelId2Models[i] = adaptor.GetModelList()
	}
	openAIModels = lo.UniqBy(openAIModels, func(m dto.OpenAIModels) string {
		return m.Id
	})
}

func channelOwnerName(channelType int) string {
	apiType, success := common.ChannelType2APIType(channelType)
	if !success {
		return strings.ToLower(constant.GetChannelTypeName(channelType))
	}
	adaptor := relay.GetAdaptor(apiType)
	if adaptor == nil {
		return strings.ToLower(constant.GetChannelTypeName(channelType))
	}
	adaptor.Init(&relaycommon.RelayInfo{ChannelMeta: &relaycommon.ChannelMeta{
		ChannelType: channelType,
	}})
	if name := strings.TrimSpace(adaptor.GetChannelName()); name != "" {
		return name
	}
	return strings.ToLower(constant.GetChannelTypeName(channelType))
}

func getPreferredModelOwners(modelNames []string, groups []string) map[string]string {
	channelTypes, err := model.GetPreferredModelOwnerChannelTypes(modelNames, groups)
	if err != nil {
		common.SysLog(fmt.Sprintf("GetPreferredModelOwnerChannelTypes error: %v", err))
		return map[string]string{}
	}

	ownerByChannelType := make(map[int]string)
	owners := make(map[string]string, len(channelTypes))
	for modelName, channelType := range channelTypes {
		owner, ok := ownerByChannelType[channelType]
		if !ok {
			owner = channelOwnerName(channelType)
			ownerByChannelType[channelType] = owner
		}
		if owner != "" {
			owners[modelName] = owner
		}
	}
	return owners
}

func buildOpenAIModel(modelName string, ownerByModel map[string]string) dto.OpenAIModels {
	var oaiModel dto.OpenAIModels
	if staticModel, ok := openAIModelsMap[modelName]; ok {
		oaiModel = staticModel
	} else {
		oaiModel = dto.OpenAIModels{
			Id:      modelName,
			Object:  "model",
			Created: 1626777600,
			OwnedBy: "custom",
		}
	}
	if owner, ok := ownerByModel[modelName]; ok && owner != "" {
		oaiModel.OwnedBy = owner
	}
	oaiModel.SupportedEndpointTypes = model.GetModelSupportEndpointTypes(modelName)
	return oaiModel
}

type modelListGroups struct {
	userGroup   string
	tokenGroup  string
	ownerGroups []string
}

func getModelListGroups(c *gin.Context) (modelListGroups, error) {
	tokenGroup := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	ratioRange, isRatioRange, ratioRangeErr := ratio_setting.ParseTokenGroupRatioRange(tokenGroup)
	// auto 和倍率区间都是伪分组：它们不是 abilities 里的分组名，模型清单得由它们展开出来的
	// 真实分组算出来，所以这两种情况都要拿到用户自己的分组。
	if userGroup == "" && (tokenGroup == "" || tokenGroup == "auto" || isRatioRange) {
		var err error
		userGroup, err = model.GetUserGroup(c.GetInt("id"), false)
		if err != nil {
			return modelListGroups{}, err
		}
	}

	if tokenGroup == "auto" {
		return modelListGroups{
			userGroup:   userGroup,
			tokenGroup:  tokenGroup,
			ownerGroups: service.GetUserAutoGroup(userGroup),
		}, nil
	}

	// 倍率区间令牌能调用的是区间内所有分组的模型并集，按倍率升序排列——和选路时
	// 「最低价优先」的顺序一致，于是 owned_by 显示的也是真正会命中的那个分组的渠道。
	//
	// 不展开的话 ownerGroups 会是 ["ratio:0.1-0.3"] 这个不存在的分组名，
	// /v1/models 返回空列表：令牌明明能调用，客户端却一个模型都列不出来。
	if isRatioRange {
		if ratioRangeErr != nil {
			return modelListGroups{}, ratioRangeErr
		}
		inRange := service.GetUserGroupsInRatioRange(userGroup, ratioRange)
		ownerGroups := make([]string, 0, len(inRange))
		for _, candidate := range inRange {
			ownerGroups = append(ownerGroups, candidate.Group)
		}
		return modelListGroups{
			userGroup:   userGroup,
			tokenGroup:  tokenGroup,
			ownerGroups: ownerGroups,
		}, nil
	}

	group := userGroup
	if tokenGroup != "" {
		group = tokenGroup
	}
	return modelListGroups{
		userGroup:   userGroup,
		tokenGroup:  tokenGroup,
		ownerGroups: []string{group},
	}, nil
}

func ListModels(c *gin.Context, modelType int) {
	acceptUnsetRatioModel := operation_setting.SelfUseModeEnabled
	if !acceptUnsetRatioModel {
		userId := c.GetInt("id")
		if userId > 0 {
			userSettings, _ := model.GetUserSetting(userId, false)
			if userSettings.AcceptUnsetRatioModel {
				acceptUnsetRatioModel = true
			}
		}
	}

	userModelNames := make([]string, 0)
	groups, err := getModelListGroups(c)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{
			"success": false,
			"message": "get user group failed",
		})
		return
	}
	ownerGroups := groups.ownerGroups
	modelLimitEnable := common.GetContextKeyBool(c, constant.ContextKeyTokenModelLimitEnabled)
	if modelLimitEnable {
		s, ok := common.GetContextKey(c, constant.ContextKeyTokenModelLimit)
		var tokenModelLimit map[string]bool
		if ok {
			tokenModelLimit = s.(map[string]bool)
		} else {
			tokenModelLimit = map[string]bool{}
		}
		for allowModel, _ := range tokenModelLimit {
			if !acceptUnsetRatioModel {
				if !helper.HasModelBillingConfig(allowModel) {
					continue
				}
			}
			userModelNames = append(userModelNames, allowModel)
		}
	} else {
		models := service.GetGroupsEnabledModels(ownerGroups)
		for _, modelName := range models {
			if !acceptUnsetRatioModel {
				if !helper.HasModelBillingConfig(modelName) {
					continue
				}
			}
			userModelNames = append(userModelNames, modelName)
		}
	}

	ownerByModel := map[string]string{}
	if len(ownerGroups) > 0 {
		ownerByModel = getPreferredModelOwners(userModelNames, ownerGroups)
	}
	userOpenAiModels := make([]dto.OpenAIModels, 0, len(userModelNames))
	for _, modelName := range userModelNames {
		userOpenAiModels = append(userOpenAiModels, buildOpenAIModel(modelName, ownerByModel))
	}

	switch modelType {
	case constant.ChannelTypeAnthropic:
		useranthropicModels := make([]dto.AnthropicModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			useranthropicModels[i] = dto.AnthropicModel{
				ID:          model.Id,
				CreatedAt:   time.Unix(int64(model.Created), 0).UTC().Format(time.RFC3339),
				DisplayName: model.Id,
				Type:        "model",
			}
		}
		// 空列表是正常结果（令牌限定的模型一个都没配价、或分组里一个都没有），
		// 直接索引 [0] 会 panic 成 500。Anthropic 官方对空列表也是回 null。
		var firstID, lastID any
		if len(useranthropicModels) > 0 {
			firstID = useranthropicModels[0].ID
			lastID = useranthropicModels[len(useranthropicModels)-1].ID
		}
		c.JSON(200, gin.H{
			"data":     useranthropicModels,
			"first_id": firstID,
			"has_more": false,
			"last_id":  lastID,
		})
	case constant.ChannelTypeGemini:
		userGeminiModels := make([]dto.GeminiModel, len(userOpenAiModels))
		for i, model := range userOpenAiModels {
			userGeminiModels[i] = dto.GeminiModel{
				Name:        model.Id,
				DisplayName: model.Id,
			}
		}
		c.JSON(200, gin.H{
			"models":        userGeminiModels,
			"nextPageToken": nil,
		})
	default:
		c.JSON(200, gin.H{
			"success": true,
			"data":    userOpenAiModels,
			"object":  "list",
		})
	}
}

func ChannelListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    openAIModels,
	})
}

func DashboardListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    channelId2Models,
	})
}

func EnabledListModels(c *gin.Context) {
	c.JSON(200, gin.H{
		"success": true,
		"data":    model.GetEnabledModels(),
	})
}

func RetrieveModel(c *gin.Context, modelType int) {
	modelId := c.Param("model")
	if aiModel, ok := openAIModelsMap[modelId]; ok {
		switch modelType {
		case constant.ChannelTypeAnthropic:
			c.JSON(200, dto.AnthropicModel{
				ID:          aiModel.Id,
				CreatedAt:   time.Unix(int64(aiModel.Created), 0).UTC().Format(time.RFC3339),
				DisplayName: aiModel.Id,
				Type:        "model",
			})
		default:
			c.JSON(200, aiModel)
		}
	} else {
		openAIError := types.OpenAIError{
			Message: fmt.Sprintf("The model '%s' does not exist", modelId),
			Type:    "invalid_request_error",
			Param:   "model",
			Code:    "model_not_found",
		}
		c.JSON(200, gin.H{
			"error": openAIError,
		})
	}
}
