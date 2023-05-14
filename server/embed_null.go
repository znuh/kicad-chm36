//go:build !embed_web
package main

import "io/fs"

var embedded_webfs fs.FS
var embedded_webfs_valid = false
