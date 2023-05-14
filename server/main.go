package main

import (
	"flag"
)

func main() {
	listen_addr     := flag.String("listen-addr", "localhost:8443", "listen address for web UI")
	webui_acl       := flag.String("allowed-ips", "<ANY>", "allowed IPs for web UI (ranges/netmasks allowed, separate multiple with a comma)")
	serve_pcbs     := flag.String("serve-pcbs", "", "serve KiCad PCBs from this dir and subdirs")
	flag.Parse()

	webif_run(*serve_pcbs, *listen_addr, *webui_acl)
}
