//go:build embed_web
package main

import "embed"

//go:embed web/*
var embedded_webfs embed.FS
var embedded_webfs_valid = true
