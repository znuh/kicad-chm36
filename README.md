# kicad-chm36
Interactive Web Browser based KiCad PCB to CHM-T36VA Pick&amp;Place File Converter  

**Conversion is done entirely in the browser. No PCB or Pick&amp;Place data is sent to a server.**

![kicad_chm_screenshot](https://github.com/znuh/kicad-chm36/assets/198567/17b367d2-8736-4213-9c25-e0e0f709fa3d)

## Basic Installation Instructions
* make the contents of the `web/` directory available via a HTTPS server
* use a browser to access the resource
* Chromium/Chrome instead of Firefox is recommended because Firefox does not (yet) implement the [window.showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker#browser_compatibility) method. (Firefox will still work, but it'll just download the generated pick&amp;place file instead of showing a Save File Dialog.)

## Using the accompanying Golang Webserver in `server/`
**Note:** This webserver is optional. You can use any HTTPS webserver. This server offers an additional feature (see below) - if you don't need it you can use any HTTPS server. (You can then skip this section.)  
**Note:** While the server per se should work on Windows as well, instructions below are for UNIX-like Operating Systems (e.g. Linux, OSX, \*BSD).

`server/` contains a small HTTPS server written in Golang. Apart from serving the `web/` directory via HTTPS, this server can also serve all KiCad PCBs from a user-specified directory and all subdirectories. This can improve your workflow if the PCB files are located on a different computer than the PnP machine is connected to. You can also reload PCB files after they changed.  
It looks like this on the client side:  
![pcbs_server](https://github.com/znuh/kicad-chm36/assets/198567/dd1d0216-1b42-4eb6-a1cc-06b9c82a2649)  
To use the server you need to do the following:
* Install a working Golang environment and OpenSSL (for HTTPS cert/key generation)
* run `cd server/ && go build;cd ..`
* there should be a binary called `kicad-server` in the `server/` directory now
* you can now run the `./run_server.sh` script to test the server  
It will generate a key+certificate and start the server offering the test PCB from the `examples/` directory.

After this works you should modify the `./run_server.sh` script to fit your needs:
* Clients must be whitelisted with the `-allowed-ips=` option. You can specify single IPs and/or IP ranges.
* KiCad PCBs from the directory given with `-serve-pcbs=` (including all subdirectories) will be served. Only files with a `.kicad_pcb` suffix will be served.
* No PCBs will be served if the `-serve-pcbs=` option isn't given.

**Note:** The DPV reference file must be located on the client. The server does not offer a DPV reference file to the client.

## Matching PCB Components to Pick&amp;Place Feeders
TBD - reasonably intelligent matching

## Preparing a DPV Reference File
TBD
