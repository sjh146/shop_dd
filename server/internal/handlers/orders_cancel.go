package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"

	"shop-dd/internal/models"

	"github.com/gin-gonic/gin"
)

// CancelOrder — POST /api/orders/:id/cancel (JWT, owner)
// pending/registered 주문 취소 + 재고 원자 복원 (CWE-639 보강 — Strix 권고).
// paid/fulfilled는 취소 불가(409), 이미 cancelled면 멱등 200.
// 게이트웨이에 등록된 on-chain orderId는 테스트넷 특성상 그대로 둔다 (미결제면 무해).
func CancelOrder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID, exists := c.Get("userId")
		if !exists {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}
		id, err := strconv.Atoi(c.Param("id"))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID"})
			return
		}

		tx, err := db.Begin()
		if err != nil {
			respondDBError(c, err)
			return
		}
		defer tx.Rollback()

		// 소유권 + 상태 확인 (행 락 — 동시 취소/결제 레이스 방지)
		var order models.Order
		err = tx.QueryRow(`
			SELECT id, user_id, wallet_address, status, total_krw, total_usdc_micro,
			       COALESCE(gateway_order_id, ''), COALESCE(tx_hash, ''), created_at, updated_at
			FROM orders WHERE id = $1 FOR UPDATE
		`, id).Scan(
			&order.ID, &order.UserID, &order.WalletAddress, &order.Status,
			&order.TotalKRW, &order.TotalUsdcMicro, &order.GatewayOrderID, &order.TxHash,
			&order.CreatedAt, &order.UpdatedAt,
		)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "order not found"})
			return
		}
		if err != nil {
			respondDBError(c, err)
			return
		}
		if order.UserID != userID {
			c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
			return
		}
		switch order.Status {
		case "paid", "fulfilled":
			c.JSON(http.StatusConflict, gin.H{"error": "paid order cannot be cancelled"})
			return
		case "cancelled":
			_ = tx.Commit() // 멱등 — 이미 취소됨
			c.JSON(http.StatusOK, gin.H{"order": order})
			return
		case "pending", "registered":
			// 취소 진행
		default:
			c.JSON(http.StatusConflict, gin.H{"error": fmt.Sprintf("order in state %s cannot be cancelled", order.Status)})
			return
		}

		// 상태 전이 (조건부 — 동시 상태 변경 방어)
		res, err := tx.Exec(`
			UPDATE orders SET status = 'cancelled', updated_at = NOW()
			WHERE id = $1 AND status IN ('pending', 'registered')
		`, id)
		if err != nil {
			respondDBError(c, err)
			return
		}
		if n, _ := res.RowsAffected(); n == 0 {
			c.JSON(http.StatusConflict, gin.H{"error": "order state changed; cannot cancel"})
			return
		}

		// 재고 복원 (같은 트랜잭션 — 실패 시 전체 롤백)
		_, err = tx.Exec(`
			UPDATE products p SET stock = p.stock + oi.qty, updated_at = NOW()
			FROM order_items oi
			WHERE oi.order_id = $1 AND oi.product_id = p.id
		`, id)
		if err != nil {
			respondDBError(c, err)
			return
		}

		if err := tx.Commit(); err != nil {
			respondDBError(c, err)
			return
		}

		order.Status = "cancelled"
		c.JSON(http.StatusOK, gin.H{"order": order})
	}
}
