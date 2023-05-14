package main

import (
	"fmt"
	"log"
	"strings"
	"io/fs"
	"time"
	"net"
	"os"
	"net/http"
	"encoding/json"

	"github.com/netdata/go.d.plugin/pkg/iprange"
)

type WSConfig struct {
	acl                 iprange.Pool      // allowed IPs
	pcbs_dir            string            // PCBs directory
	valid_pcbs          map[string]bool   // map of valid PCB paths
	pcbs_list         []byte              // JSON list of PCBs
}

type PCB struct {
	Path      string
	ModTime   time.Time
}

func refresh_pcbs(cfg *WSConfig) {
	if len(cfg.pcbs_dir) < 1  { return }

	cfg.valid_pcbs  = make(map[string]bool)
	pcbs_list      := []PCB{};

	pcbs_fs    := os.DirFS(cfg.pcbs_dir)

	log.Println("refreshing list of PCBs");
	fs.WalkDir(pcbs_fs, ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			log.Fatal(err)
		}
		if (!d.IsDir()) && strings.HasSuffix(path, ".kicad_pcb") {
			info, err := d.Info()
			if err != nil {
				log.Fatal(err)
				return err
			}
			//log.Println(info.ModTime())
			cfg.valid_pcbs[path] = true
			pcbs_list  = append(pcbs_list, PCB{Path:path, ModTime: info.ModTime()})
			//fmt.Println(path)
		}
		return nil
	})
	cfg.pcbs_list, _ = json.Marshal(pcbs_list)
	log.Println("found",len(cfg.valid_pcbs),"PCBs");
}

func returnCode403(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusForbidden)
	w.Write([]byte("403 Forbidden"))
}

func auth_check(w http.ResponseWriter, req *http.Request, acl iprange.Pool) bool {
	if acl == nil {  /* allow all if ACL is nil */
		return true
	}
	ip, _, _ := net.SplitHostPort(req.RemoteAddr)
	allowed  := acl.Contains(net.ParseIP(ip))
	if !allowed {
		log.Println("client",ip,"not authorized in whitelist")
		returnCode403(w, req)
	}
	return allowed
}

func auth_wrap(h http.Handler, cfg *WSConfig) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if auth_check(w, req, cfg.acl) {
			h.ServeHTTP(w, req)
		}
  })
}

func pcb_request(h http.Handler, cfg *WSConfig) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if !auth_check(w, req, cfg.acl) {
			return
		}
		url := req.URL.String()
		//log.Println(url)
		if cfg.valid_pcbs[url] {
			h.ServeHTTP(w, req)
		} else if url == "" || url == "?refresh" {
			if url == "?refresh" {
				refresh_pcbs(cfg)
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			w.Write(cfg.pcbs_list)
		} else {
			returnCode403(w, req)
		}
  })
}

func webif_run(serve_pcbs string, listen_spec string, webui_acl string) {
	cfg := &WSConfig{pcbs_dir : serve_pcbs}   //acl iprange.Pool  default: nil (ALLOW ALL)

	log.SetFlags(0)

	// parse listen address
	listen_host, listen_port, err := net.SplitHostPort(listen_spec)
	if err != nil {
		log.Fatal("ERROR: invalid listen ", err)
	}
	listen_addr := listen_host + ":" + listen_port
	fmt.Println("listen address :", listen_addr)

	/* parse client whitelist (if given)
	   if no client whitelist is provided *ALL* clients will be allowed! */
	if webui_acl != "<ANY>" {
		ranges := strings.ReplaceAll(webui_acl, ",", " ")
		cfg.acl, err = iprange.ParseRanges(ranges)
		if err != nil {
			log.Fatal("ERROR: ", err)
		}
		if cfg.acl == nil { // make empty string result in empty range instead of nil
			cfg.acl = []iprange.Range{}
			fmt.Println("allowed clients:", "*NONE*", "- very nobody - many blocked - wow!")
		} else {
			fmt.Println("allowed clients:", cfg.acl)
		}
	}

	// smack user if they attempt to start non-localhost server without restricting access through -allowed-ips
	if (listen_host != "127.0.0.1") && (listen_host != "localhost") && (cfg.acl == nil) {
		fmt.Println("allowed clients:", "*ANY*")
		str := "ERROR: I'm sorry Dave, I'm afraid I can't do that.\n"
		str += "       For a non-localhost listen address you *MUST* provide a list of allowed clients with -allowed-ips."
		log.Fatal(str)
	}

	// serve embedded webfs or web/ directory?
	var web_fs http.FileSystem
	if(embedded_webfs_valid) {
		fmt.Println("serving embedded webfs")
		fsys       := fs.FS(embedded_webfs)
		webdir, _  := fs.Sub(fsys, "web")
		web_fs      = http.FS(webdir)
	} else {
		fmt.Println("serving web/ directory")
		web_fs      = http.Dir("./web")
	}

	http.Handle("/", auth_wrap(http.FileServer(web_fs), cfg))

	if len(serve_pcbs) > 0 {
		refresh_pcbs(cfg)
		pcbs_fs := http.Dir(serve_pcbs)
		http.Handle("/pcbs/", http.StripPrefix("/pcbs/", pcb_request(http.FileServer(pcbs_fs), cfg)))
	}

	fmt.Println("open this link in your browser: https://localhost:"+listen_port)

	err = http.ListenAndServeTLS(listen_addr, "server.pem", "server.key", nil)
	if err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}
