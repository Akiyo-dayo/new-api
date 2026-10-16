package model

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

// 三个落库函数都是不带幂等键的 `col = col + ?`。所以「失败就放回缓冲区重放」只有在
// 能确定那条 UPDATE 没生效时才安全：服务端已经提交、客户端没读到应答时重放，
// 就是同一笔扣费扣两次，而消费日志只有一笔。
//
// 这张表钉住那条分界线：服务端拒绝 = 确定没生效 = 可以重放；连接出事 = 不可判定 = 丢弃。
func TestDeltaMayHaveLandedSeparatesServerRejectionFromLostAnswer(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"没有错误", nil, false},
		{"服务端拒绝：表不存在", errors.New("no such table: tokens"), false},
		{"服务端拒绝：约束冲突", gorm.ErrDuplicatedKey, false},
		{"连接早已归还，语句没发出去", sql.ErrConnDone, false},
		// 驱动契约：只要存在服务端可能已执行的可能性就不许返回 ErrBadConn。
		{"驱动判定连接坏了", driver.ErrBadConn, false},
		{"包装过的 ErrBadConn", fmt.Errorf("gorm: %w", driver.ErrBadConn), false},

		{"语句超时", context.DeadlineExceeded, true},
		{"请求被取消", context.Canceled, true},
		{"读应答时连接断了", io.EOF, true},
		{"应答读到一半断了", io.ErrUnexpectedEOF, true},
		{"网络错误", &net.OpError{Op: "read", Err: errors.New("connection reset by peer")}, true},
		{"包装过的网络错误", fmt.Errorf("driver: %w",
			&net.OpError{Op: "write", Err: errors.New("broken pipe")}), true},
		{"包装过的超时", fmt.Errorf("query: %w", context.DeadlineExceeded), true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, deltaMayHaveLanded(tc.err))
		})
	}
}

// failUpdatesWith 让所有 UPDATE 都以指定错误失败，用来在批量落库路径上注入
// 「语句发出去了但没拿到应答」这种真实里很难构造的故障。
func failUpdatesWith(t *testing.T, db *gorm.DB, injected error) {
	t.Helper()
	const cbName = "batch_update_indoubt_probe"
	require.NoError(t, db.Callback().Update().Before("gorm:update").
		Register(cbName, func(tx *gorm.DB) {
			_ = tx.AddError(injected)
		}))
	t.Cleanup(func() {
		_ = db.Callback().Update().Remove(cbName)
	})
}

// 不可判定的失败不能放回缓冲区：重放会把已经提交的那笔再扣一遍。
func TestBatchUpdateDropsDeltaWhenTheAnswerWasLost(t *testing.T) {
	db := setupBatchUpdateTest(t)
	failUpdatesWith(t, db, &net.OpError{Op: "read", Err: errors.New("connection reset by peer")})

	addNewRecord(BatchUpdateTypeTokenQuota, 1, -30)
	addNewRecord(BatchUpdateTypeUserQuota, 1, -30)
	addNewRecord(BatchUpdateTypeChannelUsedQuota, 1, 30)

	FlushBatchUpdates()

	assert.Zero(t, pendingCount(BatchUpdateTypeTokenQuota),
		"连接出事时无法确定语句提交没提交，重放就是重复扣费")
	assert.Zero(t, pendingCount(BatchUpdateTypeUserQuota))
	assert.Zero(t, pendingCount(BatchUpdateTypeChannelUsedQuota))
}

// 反证：同一条注入路径换成服务端拒绝，三笔增量必须全部留在缓冲区等下一轮。
//
// 没有这一条，上面那三个 Zero 可以靠「任何失败都丢弃」通过——那等于把重放整个废掉，
// 数据库短暂不可用时的扣费就全丢了。
func TestBatchUpdateStillRetriesWhenTheServerRejectedTheStatement(t *testing.T) {
	db := setupBatchUpdateTest(t)
	failUpdatesWith(t, db, errors.New("no such table: tokens"))

	addNewRecord(BatchUpdateTypeTokenQuota, 1, -30)
	addNewRecord(BatchUpdateTypeUserQuota, 1, -30)
	addNewRecord(BatchUpdateTypeChannelUsedQuota, 1, 30)

	FlushBatchUpdates()

	assert.Equal(t, 1, pendingCount(BatchUpdateTypeTokenQuota),
		"服务端拒绝说明语句确定没生效，这笔钱必须留着重放")
	assert.Equal(t, 1, pendingCount(BatchUpdateTypeUserQuota))
	assert.Equal(t, 1, pendingCount(BatchUpdateTypeChannelUsedQuota))
}
