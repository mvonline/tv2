package main

import (
	"database/sql"
	"encoding/json"
	"net/http"

	_ "github.com/mattn/go-sqlite3"
)

type CategoryConfig struct {
	Slug      string `json:"slug"`
	Label     string `json:"label"`
	SortOrder int    `json:"sort_order"`
	Active    bool   `json:"active"`
}

var defaultCategories = []CategoryConfig{
	{Slug: "sport", Label: "Sport", SortOrder: 10, Active: true},
	{Slug: "movie", Label: "Movies", SortOrder: 20, Active: true},
	{Slug: "news", Label: "News", SortOrder: 30, Active: true},
	{Slug: "music", Label: "Music", SortOrder: 40, Active: true},
	{Slug: "kids", Label: "Kids", SortOrder: 50, Active: true},
	{Slug: "documentary", Label: "Documentary", SortOrder: 60, Active: true},
	{Slug: "religious", Label: "Religious", SortOrder: 70, Active: true},
	{Slug: "entertainment", Label: "Entertainment", SortOrder: 80, Active: true},
	{Slug: "education", Label: "Education", SortOrder: 90, Active: true},
	{Slug: "series", Label: "Series & drama", SortOrder: 100, Active: true},
	{Slug: "lifestyle", Label: "Lifestyle", SortOrder: 110, Active: true},
	{Slug: "international", Label: "International", SortOrder: 120, Active: true},
	{Slug: "radio", Label: "Radio", SortOrder: 130, Active: true},
	{Slug: "other", Label: "Other", SortOrder: 9990, Active: true},
}

// CategoriesHandler serves /api/categories
func CategoriesHandler(dbPath string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		if dbPath != "" {
			db, err := sql.Open("sqlite3", dbPath)
			if err == nil {
				defer db.Close()
				rows, err := db.Query("SELECT slug, label, sort_order, active FROM categories WHERE active = 1 ORDER BY sort_order ASC")
				if err == nil {
					defer rows.Close()
					var cats []CategoryConfig
					for rows.Next() {
						var c CategoryConfig
						var activeInt int
						if err := rows.Scan(&c.Slug, &c.Label, &c.SortOrder, &activeInt); err == nil {
							c.Active = (activeInt != 0)
							cats = append(cats, c)
						}
					}
					if len(cats) > 0 {
						_ = json.NewEncoder(w).Encode(cats)
						return
					}
				}
			}
		}

		// Fallback to default categories if DB is not found or empty
		_ = json.NewEncoder(w).Encode(defaultCategories)
	}
}

// ChannelConfigHandler serves /api/channel-config
func ChannelConfigHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	response := map[string]interface{}{
		"category_overrides": map[string]string{},
		"channel_order":      map[string][]string{},
	}
	_ = json.NewEncoder(w).Encode(response)
}
