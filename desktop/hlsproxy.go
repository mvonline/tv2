package main

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Same allowlist as backend hls_proxy.allowed_host / config.stream_requires_proxy.
var allowedHostSuffixes = []string{".hls2.xyz", ".presstv.ir", ".telewebion.ir"}

func isHostAllowed(hostname string) bool {
	h := strings.ToLower(hostname)
	for _, suffix := range allowedHostSuffixes {
		if strings.HasSuffix(h, suffix) {
			return true
		}
	}
	return false
}

// Telewebion checks its own embedder origin, not aparatchii.com.
func embedderOrigin(hostname string) string {
	h := strings.ToLower(hostname)
	if h == "telewebion.ir" || strings.HasSuffix(h, ".telewebion.ir") {
		return "https://www.telewebion.com"
	}
	return "https://www.aparatchii.com"
}

var uriRegex = regexp.MustCompile(`URI="([^"]+)"`)

// HLSProxyHandler handles /proxy/hls requests, adding embedder headers and rewriting M3U8 playlists.
func HLSProxyHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
		return
	}

	target := r.URL.Query().Get("url")
	if target == "" {
		http.Error(w, "Missing url parameter", http.StatusBadRequest)
		return
	}

	targetURL, err := url.Parse(target)
	if err != nil || !isHostAllowed(targetURL.Hostname()) {
		http.Error(w, "Host not allowed", http.StatusForbidden)
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, target, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Upstream headers matching the embedder context the CDN expects
	origin := embedderOrigin(targetURL.Hostname())
	req.Header.Set("Referer", origin+"/")
	req.Header.Set("Origin", origin)
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	req.Header.Set("Sec-Fetch-Mode", "cors")
	req.Header.Set("Sec-Fetch-Dest", "empty")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
		return
	}

	contentType := resp.Header.Get("Content-Type")
	lowerTarget := strings.ToLower(target)
	isM3U8 := strings.Contains(lowerTarget, ".m3u8") ||
		strings.Contains(contentType, "mpegurl") ||
		strings.Contains(contentType, "m3u")

	// Base URL of the proxy request itself for playlist rewriting
	proxySelfBase := fmt.Sprintf("http://%s/proxy/hls", r.Host)

	if isM3U8 {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-cache")

		scanner := bufio.NewScanner(resp.Body)
		var rewritten []string

		for scanner.Scan() {
			line := scanner.Text()
			trimmed := strings.TrimSpace(line)

			if trimmed == "" {
				rewritten = append(rewritten, line)
				continue
			}

			// 1. Rewrite URI="..." attributes in tag lines (e.g., #EXT-X-KEY or #EXT-X-MAP)
			if loc := uriRegex.FindStringSubmatch(trimmed); len(loc) > 1 {
				subURL, err := url.Parse(loc[1])
				if err == nil {
					resolved := targetURL.ResolveReference(subURL)
					if isHostAllowed(resolved.Hostname()) {
						proxied := fmt.Sprintf("%s?url=%s", proxySelfBase, url.QueryEscape(resolved.String()))
						line = strings.Replace(line, loc[0], fmt.Sprintf(`URI="%s"`, proxied), 1)
					}
				}
				rewritten = append(rewritten, line)
				continue
			}

			// 2. Ignore comments/tags
			if strings.HasPrefix(trimmed, "#") {
				rewritten = append(rewritten, line)
				continue
			}

			// 3. Rewrite segment lines
			subURL, err := url.Parse(trimmed)
			if err == nil {
				resolved := targetURL.ResolveReference(subURL)
				if isHostAllowed(resolved.Hostname()) {
					line = fmt.Sprintf("%s?url=%s", proxySelfBase, url.QueryEscape(resolved.String()))
				}
			}
			rewritten = append(rewritten, line)
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(strings.Join(rewritten, "\n")))
		return
	}

	// For video/audio binary segments (.ts, .m4s)
	if contentType != "" {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	w.Header().Set("Cache-Control", "public, max-age=30")
	w.WriteHeader(http.StatusOK)
	io.Copy(w, resp.Body)
}
