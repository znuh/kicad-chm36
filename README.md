# kicad-chm36
Interactive Web Browser based KiCad PCB to CHM-T36VA Pick&amp;Place File Converter  

This tool directly generates a CHM DPV file from a `.kicad_pcb` file (without exporting a `.pos` file in KiCad before).

**Conversion is done entirely in the browser. No PCB or Pick&amp;Place data is sent to a server.**  
Also, the tool only uses locally hosted (i.e. no external CDNs) [Bootstrap5](https://getbootstrap.com/) and vanilla Javascript **without** jQuery, Node.js, etc.

## Current Limitations
* PCB height cannot be set (yet)
* Single PCB mode only (no batch/array mode yet)
* Centroid correction not supported yet
* PCBs should be KiCad Version 7.0 (other versions might or might not work)

## Screenshot
![kicad_chm_screenshot](https://github.com/znuh/kicad-chm36/assets/198567/24559599-0d31-487c-ae23-d8bf4ccf174a)

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
The CHM DPV (CSV) file format doesn't have dedicated fields for listing the params of the components held by the feeders. There is only a `Note` field which can be used to store component information for a feeder. Instead of using an extra file to hold the component params for the feeders, this tool expects all relevant component params in the `Note` field of the feeder definitions.  
When entering the `Note` for a feeder, the CharmHigh software restricts the number of characters and blocks several characters. This can be overcome by using a text editor to edit the `Note` field. (Any simple editor such as Notepad is fine.) A long `Note` field is usually fine for the CHM software when loading a DPV file - even long Notes are usually displayed just fine. The length limit is only imposed during user input.  
When modifying the `Note` field with an editor you can also use nearly all characters such as spaces, dots and (semi)colons. **You must not use commas and line breaks though** because DPV files are CSV files with a comma separator. You cannot escape commas and quoting text also does not help. So just don't put a comma (or a line break) into the `Note` field.

This tool employs a reasonably intelligent approach for matching KiCad components to Pick&amp;Place feeders. A match occurs when the following conditions are satisfied:
* The KiCad **footprint** identifier (e.g. `C_0402_1005Metric`) must be found somewhere in the **Feeder Note**.
* After this the **KiCad Value** and the **Feeder Note** are treated as lists of whitespace separated params. (i.e. you put at least one space between different params - e.g.: `1uF 10V X5R`)
* The **first value** in this list is called the *Primary Value*. The *Primary Value* from KiCad and a feeder must be equal.  
  * **Units** are optional - e.g. a `10k` KiCad Primary Value will match a `10k` and a `10kR` feeder note.  
(Units are optional because the KiCad footprint identifier already includes the component type C/R/etc.)
  * However, if both the KiCad primary value and the Feeder Note primary value have a unit then these units must match.
  * Units `R` and `Ω` are treated as equivalent. (e.g. `10kR` and `10kΩ` will match)
  * Value comparison honors **multipliers** such as `p/n/u/µ/m/k/M/G` - i.e. `0.1uF` matches `0.1µF` and `100nF`; `10000` and `10k` also match.
  * **Limitation:** `1k5` will **not** match `1.5k`. Just avoid using the multiplier as the decimal point.
* While the KiCad and Feeder Primary Values must be equal for a match, there are also *Secondary Values* such as **ratings and tolerances**. For these values the Feeder Value must be **same or better** than the KiCad Value for a match.
  * Secondary Values are recognized by their unit (ratings: `V/A/W`, tolerances: `%/ppm`). If they are not recognized as rating or tolerance they must match exactly.
  * All KiCad Secondary Values must be satisfied by a Secondary Value from the Feeder Note.  
(Secondary Values only found in the Feeder Note but not in the KiCad Value are ignored - i.e. they don't inhibit a match.)
  * For **ratings** the feeder value must be equal or greater than the KiCad value
  * For **tolerances** the feeder value must be equal or less than the KiCad value
  * **Limitation 1:** Fractional notation (e.g. `1/8W`) isn't supported. Use notation with a decimal point (e.g. `0.125W`) instead.
  * **Limitation 2:** Temperature Coefficients such as **X7R** aren't recognized. This means that they must match exactly. A feeder with *X7R* in the note will not match a KiCad Value containing *X5R*. (If you don't add *X5R* to the KiCad value it can match the feeder if the other values are ok.)

The DPV and KiCad PCB files from the [examples](https://github.com/znuh/kicad-chm36/tree/main/examples) directory are selected to demonstrate several of the matching rules explained here.

### Feeder Note Example: ###
`0.1uF 25V X5R 10% fp:C_0402_1005Metric pn:CL05A104KA5NNNC`  
Note 1: I usually add the exact part number marked with `pn:` at the end of the Feeder Note. This does not break component matching.  
Note 2: I also prefer to prefix the footprint with `fp:` in the Feeder Note. This is also ok because for a match to occur the KiCad footprint identifier (`C_0402_1005Metric`) only needs to be found *somewhere* in the Feeder Note.

## Additional Named Feeder Params
The CHM DPV file format doesn't store the nozzle to use for a feeder in the Feeder Definition but in the individual component placement instruction (`PHead` as in PickHead in the `EComponent` lines). The DPV file also does not store the rotation of components in a certain feeder. Instead there's only the relative rotation of a component to apply during placement of a component. (`Angle` in the `EComponent` lines.)  
**Named Params** in the `Notes` field of a Feeder can be given to specify the **rotation** of components held in this feeder and to choose the **nozzle** to use for the Feeder:
* `nozzle:1` sets the nozzle to 1 (left nozzle). Nozzle 2 is the right nozzle. **Nozzle 1** will be used as the **default** when no **nozzle** param is given. (So you can just omit `nozzle:1` for nozzle 1.)
* `orientation:<angle>` can be used to specify the component rotation in a feeder relative to the KiCad 0° orientation. For reel feeders (Feeder IDs below 60) this is usually +90° (resulting in a -90° rotation to apply for a KiCad component with 0° orientation.)  
Specify the orientation without the degree sign - e.g. `orientation:90` / `orientation:-90`.  
When no component orientation is given for a feeder, a default orientation is selected based on the **Feeder ID**:
  * The default for IDs **below 60** (reel feeders) is a component orientation of +90°
  * The default for ID **60 and above** (IC trays and vibration feeders) is 0°  
* You can omit the `orientation:` param when the default orientation is correct.

## Preparing a DPV Reference File
TBD
