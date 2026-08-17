package handlers

import "testing"

// TestKRWToUsdcMicro verifies the KRW→USDC micro-unit conversion.
//
// Formula: micro = round(total_krw / 1350.0) * 1_000_000
// Note: Go's math.Round rounds half away from zero, so 0.5 → 1.
func TestKRWToUsdcMicro(t *testing.T) {
	cases := []struct {
		name     string
		krw      int
		expected int64
	}{
		{"exactly one USDC", 1350, 1_000_000},
		{"exactly two USDC", 2700, 2_000_000},
		// 675/1350 = 0.5 → math.Round(0.5) = 1 (half away from zero) → 1 USDC
		{"half USDC rounds up", 675, 1_000_000},
		{"zero", 0, 0},
		// 100000/1350 = 74.074... → round = 74 → 74 USDC
		{"large amount", 100000, 74_000_000},
		// 1351/1350 = 1.0007 → round = 1 → 1 USDC
		{"just above one USDC", 1351, 1_000_000},
		// 2025/1350 = 1.5 → round = 2 → 2 USDC
		{"one and a half USDC rounds up", 2025, 2_000_000},
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
