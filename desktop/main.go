package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend_dist
var embeddedAssets embed.FS

type TV2Service struct{}

func (s *TV2Service) GetAppVersion() string {
	return "2.0.0-wails3"
}

func main() {
	// 1. Locate categories.db if available locally
	exePath, err := os.Executable()
	dbPath := ""
	if err == nil {
		possibleDb := filepath.Join(filepath.Dir(exePath), "categories.db")
		if _, err := os.Stat(possibleDb); err == nil {
			dbPath = possibleDb
		}
	}
	if dbPath == "" {
		// Fallback to repository path during development
		relDb := filepath.Join("..", "backend", "data", "categories.db")
		if _, err := os.Stat(relDb); err == nil {
			dbPath = relDb
		}
	}

	// 2. Prepare embedded frontend filesystem
	subFS, err := fs.Sub(embeddedAssets, "frontend_dist")
	if err != nil {
		log.Fatalf("Failed to initialize sub filesystem for assets: %v", err)
	}
	fileServer := http.FileServer(http.FS(subFS))

	// 3. Combine asset server, API, and HLS proxy into a unified HTTP handler
	mux := http.NewServeMux()
	mux.HandleFunc("/proxy/hls", HLSProxyHandler)
	mux.HandleFunc("/api/categories", CategoriesHandler(dbPath))
	mux.HandleFunc("/api/channel-config", ChannelConfigHandler)
	mux.Handle("/logo/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Clean up nested /logo/logo/ paths if requested by frontend
		p := r.URL.Path
		if strings.HasPrefix(p, "/logo/logo/") {
			r.URL.Path = strings.Replace(p, "/logo/logo/", "/logo/", 1)
		}
		fileServer.ServeHTTP(w, r)
	}))
	mux.Handle("/", fileServer)

	// 4. Create Wails v3 Application
	app := application.New(application.Options{
		Name:        "TV2",
		Description: "TV2 Live TV Channel Guide & Player",
		Assets: application.AssetOptions{
			Handler: mux,
		},
		Services: []application.Service{
			application.NewService(&TV2Service{}),
		},
	})

	// 5. Configure Main Window
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "TV2 — Live TV Guide",
		Width:     1366,
		Height:    800,
		MinWidth:  900,
		MinHeight: 600,
		URL:       "/",
	})

	fmt.Println("Launching TV2 Wails v3 Desktop Application...")
	err = app.Run()
	if err != nil {
		log.Fatalf("Failed to run Wails application: %v", err)
	}
}
