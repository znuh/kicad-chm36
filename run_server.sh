#!/bin/sh
if [ ! -f server.key ]
then
	echo "generating TLS key (server.key) first"
	openssl ecparam -genkey -name secp384r1 -out server.key
fi
if [ ! -f server.pem ]
then
	echo "generating TLS cert (server.pem) first"
	openssl req -new -x509 -sha256 -key server.key -out server.pem -days 3650
fi
./server/kicad-server -serve-pcbs=examples/ -listen-addr=:8443 -allowed-ips=127.0.0.1,::1
