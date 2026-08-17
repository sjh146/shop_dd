package sync

import (
	"database/sql"
	"log"
	"time"
)

// ExpirePendingOrders — 미결제(pending) 주문 만료 + 재고 복원 (Strix 권고 2).
// maxPendingAge(기본 15분) 이상 pending인 주문을 cancelled로 전이하고,
// 해당 주문의 예약 재고를 원자적으로 복원한다. registered 주문은 건드리지 않음
// (사용자가 결제 진행 중일 수 있으므로). 실패 시 로그 + 다음 틱 재시도.
func ExpirePendingOrders(shopDB *sql.DB, maxPendingAge time.Duration) (int, error) {
	tx, err := shopDB.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`
		UPDATE orders SET status = 'cancelled', updated_at = NOW()
		WHERE status = 'pending'
		  AND created_at < NOW() - ($1 || ' seconds')::interval
		RETURNING id
	`, int(maxPendingAge.Seconds()))
	if err != nil {
		return 0, err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	// 만료된 주문의 예약 재고 복원 (같은 트랜잭션)
	for _, id := range ids {
		if _, err := tx.Exec(`
			UPDATE products p SET stock = p.stock + oi.qty, updated_at = NOW()
			FROM order_items oi
			WHERE oi.order_id = $1 AND oi.product_id = p.id
		`, id); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	if len(ids) > 0 {
		log.Printf("[sync] expired %d pending order(s), stock restored", len(ids))
	}
	return len(ids), nil
}
