package perfmetrics

import (
	"fmt"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/perf_metrics_setting"
)

func flushLoop() {
	for {
		interval := perf_metrics_setting.GetFlushIntervalMinutes()
		time.Sleep(time.Duration(interval) * time.Minute)
		flushTick()
	}
}

// flushTick 是周期性 flush 的一轮。抽出来是为了能直接测两条契约：关掉开关时什么都不做、
// 以及**不写当前那个还没结束的桶**（写了会让每个采样都单独 upsert 一次）。
func flushTick() {
	setting := perf_metrics_setting.GetSetting()
	if !setting.Enabled {
		return
	}
	flushBuckets(false)
	cleanupExpiredMetrics(setting.RetentionDays)
}

// Flush 把内存里的性能采样立刻落库，**包括当前那个还没结束的时间桶**。
//
// 进程退出前调一次。周期性 flush 故意只写"已完成"的桶，所以正在累积的那个桶一直只存在
// 于内存里；默认桶宽一小时，重启就等于丢掉最多一小时的采样，而模型广场的成功率/延迟/TPS
// 用的就是这份数据。提前写部分桶是安全的：model.UpsertPerfMetric 是累加型 upsert，
// 重启后新进程从空桶重新累积、最终加到同一行上，既不会重复也不会丢。
func Flush() {
	flushBuckets(true)
}

// flushBuckets 把热桶落库。includeCurrentBucket 只在进程退出时为真——常态下写当前桶会让
// 每个采样都单独 upsert 一次，写放大与桶宽成反比。
func flushBuckets(includeCurrentBucket bool) {
	currentBucket := bucketStart(time.Now().Unix())
	hotBuckets.Range(func(key, value any) bool {
		k := key.(bucketKey)
		if !includeCurrentBucket && k.bucketTs >= currentBucket {
			return true
		}

		bucket := value.(*atomicBucket)
		drained := bucket.drain()
		if drained.requestCount == 0 {
			deleteOldEmptyBucket(k, key)
			return true
		}

		err := model.UpsertPerfMetric(&model.PerfMetric{
			ModelName:      k.model,
			Group:          k.group,
			BucketTs:       k.bucketTs,
			RequestCount:   drained.requestCount,
			SuccessCount:   drained.successCount,
			TotalLatencyMs: drained.totalLatencyMs,
			TtftSumMs:      drained.ttftSumMs,
			TtftCount:      drained.ttftCount,
			OutputTokens:   drained.outputTokens,
			GenerationMs:   drained.generationMs,
		})
		if err != nil {
			bucket.addCounters(drained)
			common.SysError(fmt.Sprintf("failed to flush perf metric bucket model=%s group=%s bucket=%d: %s", k.model, k.group, k.bucketTs, err.Error()))
			return true
		}

		deleteOldEmptyBucket(k, key)
		return true
	})
}

func deleteOldEmptyBucket(k bucketKey, rawKey any) {
	if k.bucketTs < bucketStart(time.Now().Add(-24*time.Hour).Unix()) {
		hotBuckets.Delete(rawKey)
	}
}

func cleanupExpiredMetrics(retentionDays int) {
	if retentionDays <= 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour).Unix()
	if err := model.DeletePerfMetricsBefore(cutoff); err != nil {
		common.SysError("failed to cleanup expired perf metrics: " + err.Error())
	}
}

func redisCounters(values map[string]string) counters {
	return counters{
		requestCount:   parseRedisInt(values["req"]),
		successCount:   parseRedisInt(values["ok"]),
		totalLatencyMs: parseRedisInt(values["lat"]),
		ttftSumMs:      parseRedisInt(values["ttft"]),
		ttftCount:      parseRedisInt(values["ttft_n"]),
		outputTokens:   parseRedisInt(values["out"]),
		generationMs:   parseRedisInt(values["gen_ms"]),
	}
}

func parseRedisInt(value string) int64 {
	if value == "" {
		return 0
	}
	parsed, _ := strconv.ParseInt(value, 10, 64)
	return parsed
}
