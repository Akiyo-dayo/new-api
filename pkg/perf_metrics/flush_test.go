package perfmetrics

import (
	"fmt"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/config"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupPerfMetricsTest(t *testing.T) *gorm.DB {
	t.Helper()

	previousDB, previousRedis := model.DB, common.RedisEnabled
	t.Cleanup(func() {
		model.DB = previousDB
		common.RedisEnabled = previousRedis
		hotBuckets.Range(func(key, _ any) bool {
			hotBuckets.Delete(key)
			return true
		})
	})

	db, err := gorm.Open(sqlite.Open(
		fmt.Sprintf("file:perf-metrics-test-%s?mode=memory&cache=shared", common.GetRandomString(8))),
		&gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	common.RedisEnabled = false
	require.NoError(t, db.AutoMigrate(&model.PerfMetric{}))
	return db
}

func metricRows(t *testing.T, db *gorm.DB) []model.PerfMetric {
	t.Helper()
	var rows []model.PerfMetric
	require.NoError(t, db.Find(&rows).Error)
	return rows
}

// 进程退出前必须把**当前这个还没结束的时间桶**也落库。
//
// 周期性 flush 故意只写"已完成"的桶，所以正在累积的那个桶一直只存在于内存里；
// 默认桶宽是一小时，重启就等于丢掉最多一小时的采样。模型广场的成功率/延迟/TPS
// 用的就是这份数据。落库走的是累加型 upsert，所以提前写一次部分桶是安全的：
// 重启后新进程从空桶重新累积，最终加到同一行上，不会重复也不会丢。
func TestFlushPersistsCurrentBucket(t *testing.T) {
	db := setupPerfMetricsTest(t)

	Record(Sample{Model: "probe-model", Group: "probe-group", LatencyMs: 120,
		Success: true, OutputTokens: 10, GenerationMs: 90})

	Flush()

	rows := metricRows(t, db)
	require.Len(t, rows, 1)
	assert.Equal(t, "probe-model", rows[0].ModelName)
	assert.Equal(t, "probe-group", rows[0].Group)
	assert.EqualValues(t, 1, rows[0].RequestCount)
	assert.EqualValues(t, 1, rows[0].SuccessCount)
	assert.EqualValues(t, 120, rows[0].TotalLatencyMs)
}

// 周期性 flush 的行为不能被上面那条改掉：它必须继续跳过当前桶，
// 否则每个采样都会立刻单独 upsert 一次，热路径的写放大会跟着桶宽成反比。
func TestPeriodicFlushStillSkipsCurrentBucket(t *testing.T) {
	db := setupPerfMetricsTest(t)

	Record(Sample{Model: "probe-model", Group: "probe-group", LatencyMs: 120, Success: true})

	flushTick()

	assert.Empty(t, metricRows(t, db), "当前桶还没结束，周期性 flush 不该写它")
}

// 开关关掉时这一轮什么都不该做——包括不要去跑保留期清理。
func TestPeriodicFlushDoesNothingWhenDisabled(t *testing.T) {
	db := setupPerfMetricsTest(t)

	previous := perf_metrics_setting.GetSetting()
	t.Cleanup(func() {
		require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
			"perf_metrics_setting.enabled": fmt.Sprintf("%t", previous.Enabled),
		}))
	})
	// 必须放一个**已完成**的桶：flushTick 本来就跳过当前桶，用 Record 录出来的当前桶
	// 无论开关开着还是关着都不会落库，那样断言"库里没东西"就是个空断言。
	// 也不能先关开关再 Record —— Record 自己就 no-op 了，同样测不到 flushTick。
	seedCompletedBucket(t, "probe-model", "probe-group")

	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"perf_metrics_setting.enabled": "false",
	}))
	flushTick()
	assert.Empty(t, metricRows(t, db), "开关关掉时这一轮不该落库")

	// 反证：同一个桶在开关打开时是落得进去的
	require.NoError(t, config.GlobalConfig.LoadFromDB(map[string]string{
		"perf_metrics_setting.enabled": "true",
	}))
	flushTick()
	require.Len(t, metricRows(t, db), 1)
}

// seedCompletedBucket 造一个上一小时的热桶，用来测「已完成的桶」这条分支。
func seedCompletedBucket(t *testing.T, modelName string, group string) {
	t.Helper()
	key := bucketKey{
		model:    modelName,
		group:    group,
		bucketTs: bucketStart(time.Now().Add(-2 * time.Hour).Unix()),
	}
	actual, _ := hotBuckets.LoadOrStore(key, &atomicBucket{})
	actual.(*atomicBucket).add(Sample{Model: modelName, Group: group, LatencyMs: 120, Success: true})
}

// 退出前 flush 过一次之后，同一个桶的内存计数必须被清空，
// 否则同一进程里再 flush 一次会把同一批采样重复累加进去。
func TestFlushDrainsBucketSoRepeatedFlushDoesNotDoubleCount(t *testing.T) {
	db := setupPerfMetricsTest(t)

	Record(Sample{Model: "probe-model", Group: "probe-group", LatencyMs: 120, Success: true})

	Flush()
	Flush()

	rows := metricRows(t, db)
	require.Len(t, rows, 1)
	assert.EqualValues(t, 1, rows[0].RequestCount, "第二次 flush 不能把同一批采样再算一遍")
}
