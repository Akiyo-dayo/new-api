package service

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/require"
)

func TestBuildUserSpendingRankingAssignsRanksAndTotal(t *testing.T) {
	rows := buildUserSpendingRows([]model.UserSpendingTotal{
		{UserId: 20, Username: "bob", TotalQuota: 200},
		{UserId: 10, Username: "alice", TotalQuota: 150},
	})

	require.Equal(t, int64(350), rows.TotalQuota)
	require.Equal(t, []RankedUserSpending{
		{Rank: 1, UserId: 20, Username: "bob", TotalQuota: 200},
		{Rank: 2, UserId: 10, Username: "alice", TotalQuota: 150},
	}, rows.Users)
}

func TestAttachRootUserSpendingDoesNotExposeDataToNonRoot(t *testing.T) {
	base := &RankingsResponse{}
	spending := &UserSpendingRanking{}

	nonRoot := AttachRootUserSpending(base, common.RoleAdminUser, spending)
	require.Nil(t, nonRoot.UserSpending)

	root := AttachRootUserSpending(base, common.RoleRootUser, spending)
	require.Same(t, spending, root.UserSpending)
	require.NotSame(t, base, root)
}
