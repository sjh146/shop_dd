package handlers

import "testing"

// TestKRWToUsdcMicro verifies the KRW→USDC micro-unit conversion at cent
// (0.01 USDC) precision.
//
// Formula: cents = round(total_krw / 1350.0 * 100); micro = cents * 10_000
// (1 USDC = 1_000_000 micro, so 1 cent = 10_000 micro.)
// Note: Go's math.Round rounds half away from zero, so 0.5 → 1.
func TestKRWToUsdcMicro(t *testing.T) {
	cases := []struct {
		name     string
		krw      int
		expected int64
	}{
		// 5900/1350 = 4.3703... → 437 cents → 4.37 USDC (1 USDC 반올림이면 4.0 — 손실)
		{"cent precision preserved", 5900, 4_370_000},
		{"exactly one USDC", 1350, 1_000_000},
		// 1350/2 = 675 → 0.5 USDC → 50 cents → 0.50 USDC
		{"half USDC", 675, 500_000},
		// 2025/1350 = 1.5 → 150 cents → 1.50 USDC
		{"one and a half USDC", 2025, 1_500_000},
		// 100000/1350 = 74.0740... → 7407 cents → 74.07 USDC
		{"large amount", 100000, 74_070_000},
		// 2800/1350 = 2.0740... → 207 cents → 2.07 USDC
		{"two point zero seven USDC", 2800, 2_070_000},
		{"zero", 0, 0},
		// 1351/1350 = 1.00074... → 100 cents → 1.00 USDC (센트 미만은 반올림)
		{"just above one USDC", 1351, 1_000_000},
		{"exactly two USDC", 2700, 2_000_000},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := krwToUsdcMicro(tc.krw)
			if got != tc.expected {
				t.Errorf("krwToUsdcMicro(%d) = %d, want %d", tc.krw, got, tc.expected)
			}
		})
	}
}
