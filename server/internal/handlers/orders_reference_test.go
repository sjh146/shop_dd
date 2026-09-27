package handlers

import "testing"

// TestOrderReference — 게이트웨이 reference_id가 "shop_dd-N" 네임스페이스를 유지한다.
// 주문 id 재사용 시 온체인 orderId(keccak256(reference_id))가 과거 테스트 결제
// (keccak("2") 등)와 충돌하지 않도록 하는 회귀 방지. (2026-09-27)
func TestOrderReference(t *testing.T) {
	if got, want := orderReference(3), "shop_dd-3"; got != want {
		t.Errorf("orderReference(3) = %q, want %q", got, want)
	}
	if got, want := orderReference(1), "shop_dd-1"; got != want {
		t.Errorf("orderReference(1) = %q, want %q", got, want)
	}
}
