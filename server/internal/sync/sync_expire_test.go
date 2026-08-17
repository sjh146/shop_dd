package sync

import (
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

// TestExpirePendingOrders — 15분 이상 pending 주문 1건 만료 + 재고 복원 SQL.
func TestExpirePendingOrders(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{"id"}).AddRow(int64(42))
	mock.ExpectBegin()
	mock.ExpectQuery(`
		UPDATE orders SET status = 'cancelled', updated_at = NOW()
		WHERE status = 'pending'
		  AND created_at < NOW() - ($1 || ' seconds')::interval
		RETURNING id
	`).WithArgs(900).WillReturnRows(rows)
	mock.ExpectExec(`
		UPDATE products p SET stock = p.stock + oi.qty, updated_at = NOW()
		FROM order_items oi
		WHERE oi.order_id = $1 AND oi.product_id = p.id
	`).WithArgs(int64(42)).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	n, err := ExpirePendingOrders(db, 15*time.Minute)
	if err != nil {
		t.Fatalf("ExpirePendingOrders: %v", err)
	}
	if n != 1 {
		t.Errorf("expired = %d, want 1", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestExpirePendingOrdersNone — 만료 대상 없음 → 0건, 재고 복원 SQL 없음.
func TestExpirePendingOrdersNone(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	rows := sqlmock.NewRows([]string{"id"})
	mock.ExpectBegin()
	mock.ExpectQuery(`
		UPDATE orders SET status = 'cancelled', updated_at = NOW()
		WHERE status = 'pending'
		  AND created_at < NOW() - ($1 || ' seconds')::interval
		RETURNING id
	`).WithArgs(900).WillReturnRows(rows)
	mock.ExpectCommit()

	n, err := ExpirePendingOrders(db, 15*time.Minute)
	if err != nil {
		t.Fatalf("ExpirePendingOrders: %v", err)
	}
	if n != 0 {
		t.Errorf("expired = %d, want 0", n)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet sqlmock expectations: %v", err)
	}
}

// TestExpirePendingOrdersError — DB 에러 시 0 + 에러 반환 (fail-safe).
func TestExpirePendingOrdersError(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherEqual))
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectQuery(`
		UPDATE orders SET status = 'cancelled', updated_at = NOW()
		WHERE status = 'pending'
		  AND created_at < NOW() - ($1 || ' seconds')::interval
		RETURNING id
	`).WithArgs(900).WillReturnError(sql.ErrConnDone)

	if _, err := ExpirePendingOrders(db, 15*time.Minute); err == nil {
		t.Error("expected error on DB failure, got nil")
	}
}
