package setting

import (
	"encoding/json"
	"fmt"
	"math"
	"sync"

	"github.com/QuantumNous/new-api/common"
)

var ModelRequestRateLimitEnabled = false
var ModelRequestRateLimitDurationMinutes = 1
var ModelRequestRateLimitCount = 0
var ModelRequestRateLimitSuccessCount = 1000
var ModelRequestRateLimitGroup = map[string][2]int{}
var ModelRequestRateLimitMutex sync.RWMutex

func ModelRequestRateLimitGroup2JSONString() string {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	jsonBytes, err := json.Marshal(ModelRequestRateLimitGroup)
	if err != nil {
		common.SysLog("error marshalling model ratio: " + err.Error())
	}
	return string(jsonBytes)
}

// UpdateModelRequestRateLimitGroupByJSONString 替换分组限流配置。
//
// 必须持写锁，而且必须先解析到局部 map 再整体替换。原来这里拿的是 RLock，而 RLock 是
// 共享锁：GetGroupRateLimit 同样只拿 RLock 就去读这张 map，两者可以同时持有，于是
// 「在读锁下重建 map」和「读 map」并发发生 —— Go 运行时对此的反应是 fatal error:
// concurrent map read and map write，进程直接死，recover 拦不住。
//
// 触发不需要管理员操作：model.SyncOptions 默认每 60 秒把 options 表整个重放一遍，
// 每一轮都会无条件调到这里；读侧则有每次中继请求和公开的 /api/pricing（按可见分组
// 循环读 N 次）。
//
// 先解析后替换还顺带修掉第二个问题：原写法先把 map 清空再 unmarshal，JSON 损坏时
// 会留下一张空表，等于静默地把所有分组限流降级成全局限流。
func UpdateModelRequestRateLimitGroupByJSONString(jsonStr string) error {
	updated := make(map[string][2]int)
	if err := common.Unmarshal([]byte(jsonStr), &updated); err != nil {
		return err
	}

	ModelRequestRateLimitMutex.Lock()
	defer ModelRequestRateLimitMutex.Unlock()

	ModelRequestRateLimitGroup = updated
	return nil
}

func GetGroupRateLimit(group string) (totalCount, successCount int, found bool) {
	ModelRequestRateLimitMutex.RLock()
	defer ModelRequestRateLimitMutex.RUnlock()

	if ModelRequestRateLimitGroup == nil {
		return 0, 0, false
	}

	limits, found := ModelRequestRateLimitGroup[group]
	if !found {
		return 0, 0, false
	}
	return limits[0], limits[1], true
}

func CheckModelRequestRateLimitGroup(jsonStr string) error {
	checkModelRequestRateLimitGroup := make(map[string][2]int)
	err := json.Unmarshal([]byte(jsonStr), &checkModelRequestRateLimitGroup)
	if err != nil {
		return err
	}
	for group, limits := range checkModelRequestRateLimitGroup {
		if limits[0] < 0 || limits[1] < 1 {
			return fmt.Errorf("group %s has negative rate limit values: [%d, %d]", group, limits[0], limits[1])
		}
		if limits[0] > math.MaxInt32 || limits[1] > math.MaxInt32 {
			return fmt.Errorf("group %s [%d, %d] has max rate limits value 2147483647", group, limits[0], limits[1])
		}
	}

	return nil
}
