package sync

import "testing"

// TestIsListed verifies the listed filter: status must be "manifest_ready"
// AND sale_price must parse to a positive value.
func TestIsListed(t *testing.T) {
	cases := []struct {
		name      string
		status    string
		salePrice string
		expected  bool
	}{
		{"manifest_ready with valid price", "manifest_ready", "10", true},
		{"manifest_ready with zero price", "manifest_ready", "0", false},
		{"manifest_ready with empty price", "manifest_ready", "", false},
		{"manifest_ready with zero decimal price", "manifest_ready", "0.0", false},
		{"non-manifest_ready status", "sourced", "10", false},
		{"non-manifest_ready status with zero price", "sourced", "0", false},
		{"manifest_ready with negative price", "manifest_ready", "-5", false},
		{"manifest_ready with non-numeric price", "manifest_ready", "abc", false},
		{"manifest_ready with whitespace price", "manifest_ready", "  10  ", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := isListed(tc.status, tc.salePrice)
			if got != tc.expected {
				t.Errorf("isListed(%q, %q) = %v, want %v", tc.status, tc.salePrice, got, tc.expected)
			}
		})
	}
}

// TestUSDToKRW verifies the USD→KRW conversion:
// krw = int(usd * 1350), then rounded to nearest 100.
func TestUSDToKRW(t *testing.T) {
	cases := []struct {
		name       string
		usd        string
		wantKRW    int
		wantOK     bool
	}{
		{"whole dollar", "10", 13500, true},
		{"zero", "0", 0, false},
		{"empty string", "", 0, false},
		{"non-numeric", "abc", 0, false},
		{"decimal rounds to nearest 100", "12.34", 16700, true},
		{"negative", "-1", 0, false},
		// 5*1350 = 6750 → round(67.5)*100 = 68*100 = 6800 (half away from zero)
		{"whitespace trimmed", "  5  ", 6800, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gotKRW, gotOK := usdToKRW(tc.usd)
			if gotKRW != tc.wantKRW || gotOK != tc.wantOK {
				t.Errorf("usdToKRW(%q) = (%d, %v), want (%d, %v)",
					tc.usd, gotKRW, gotOK, tc.wantKRW, tc.wantOK)
			}
		})
	}
}
