// BSD 2-Clause License

// Copyright (c) 2023 Benedikt Heinz <zn000h AT gmail.com>

// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:

// 1. Redistributions of source code must retain the above copyright notice, this
//    list of conditions and the following disclaimer.

// 2. Redistributions in binary form must reproduce the above copyright notice,
//    this list of conditions and the following disclaimer in the documentation
//    and/or other materials provided with the distribution.

// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
// AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
// IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
// DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
// FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
// DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
// SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
// CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

const version = "0.1-dev1";
const required_kicad_version = [20221018, 20221018];

const precision = 2; // round to 2 digits after decimal point

/* PCB data
 *
 * example:
 * pcb = {
 *   raw_pcb    : [...],   // Array - original data from parsed KiCad S-Expression file
 *   extents    : { ll: {x: 142.2, y: 107.1}, size: {w: 33.1, h: 26.4}, ur: {x: 175.3, y: 80.7} },   // extents and corners (KiCad coordinates) of PCB
 *   aux_origin : {x: 142.2, y: 107.1, explicit: true},  // KiCad coordinate which corresponds to pick&place origin
 *   footprints : {
 *     C : [
 *           undefined,
 *           {ref: 'C1', fp: 'C_0402_1005Metric', ... },
 *           undefined,
 *           {ref: 'C3', fp: 'C_0402_1005Metric', ... },
 *           ...
 *     ],
 *     R : [ ... ],
 *     ...
 *   } // footprints
 * } // pcb
 *
 * pcb.footprints[key] holds a sparse array where key is the reference designator of the components
 * e.g. R33 can be found in pcb.footprints.R[33]
 */
let pcb            = null;

/* dpv_reference holds the data from the loaded DPV CSV file
 * 
 * all tables are stored in dpv_reference.tables[x] where x is:
 *   "ICTray"  :  IC Tray definitions
 *   "Station" :  Feeders
 *   plus other tables
 *
 * table_templates holds a list of tables in the order they appeared in the DPV file
 * along with the field names for this table:
 * dpv_reference.table_templates = [
 *   {table: 'Station', fields: ['Table', 'No.', 'ID', 'DeltX', ...]},
 *   {table: 'Panel_Coord', fields: ['Table', 'No.', 'ID', 'DeltX', 'DeltY']},
 *   ...
 * ]
 *
 * =================================================================================================
 * 
 * dpv_reference.tables.Station holds an array of feeder objects.
 * e.g.:
 * [
 *  {"No.": "0",  "ID": "2",  "DeltX": "-1.12",  "DeltY": "1.35",   "FeedRates": "2",
 *   "Note": "0.1uF 25V X5R 10% fp:C_0402_1005Metric pn:CL05A104KA5NNNC",
 *   "Height": "0.5",  "Speed": "0",  "Status": "6",  "SizeX": "0",  "SizeY": "0",
 *   "HeightTake": "0",  "DelayTake": "0",  "nPullStripSpeed": "0" },
 * 
 *  {"No.": "1",  "ID": "3",  "DeltX": "-1.07",  "DeltY": "1.12",  "FeedRates": "2",
 *   "Note": "10k 0.0625W 50V 1% fp:R_0402_1005Metric pn:RC1005F103CS",
 *   "Height": "0.5",  "Speed": "0",  "Status": "6",  "SizeX": "0",  "SizeY": "0",
 *   "HeightTake": "0",  "DelayTake": "0",  "nPullStripSpeed": "0"},
 * ...
 * 
 * list index is just upwards counting, starting from 0
 * Station[x].No is just upwards counting as well - but this value is taken from the CSV line
 * Station[x].ID is the feeder number according to the feeder labels on the pnp machine
 * Station[x].Status is a bitmask encoding 3 bool values for place, use vision, vacuum detect
 */
let dpv_reference  = null;

/* assignments is an object with the following keys:
 *   "Fiducial"                : for fiducials
 *   "Indeterminate"           : indeterminate components
 *   (int)x in the range 0..N  : where x is the dpv_reference.tables.Station[x] index
 *
 * assignments[key] holds an array of components associated with
 *   - the dpv_reference.tables.Station[key] feeder if key is an integer
 *   - a Fiducial if key == "Fiducial"
 *   - no feeder if key == "Indeterminate"
 *
 * example:
 * assignments = {
 *   "Fiducial"      : [],
 *                 0 : [ pcb.footprints.C[1], pcb.footprints.C[3], ... ],   // components for dpv_reference.tables.Station[0] feeder
 *                 1 : [ pcb.footprints.R[2], pcb.footprints.R[3], ... ],   // components for dpv_reference.tables.Station[1] feeder
 *   "Indeterminate" : [ pcb.foorprints.U[1] ]
 * }
 */
let assignments    = null;
let pcb_side       = null;

let pcbs_list      = null; // PCB list from server
let selected_pcb   = null; // current PCB from server list

const lf = "\r\n";

function adapt_nodes(nodelist, new_extension, node_table) {
	if ((!nodelist) || (nodelist.length < 1))
		return;
	let res = node_table ?? [];
	nodelist.forEach(n => {
		// adapt for-tags as well
		if (n.attributes && n.attributes["for"] && (n.attributes["for"].value.slice(-1) == "-"))
			n.attributes["for"].value += new_extension;

		// adapt IDs
		if (n.id && (n.id.slice(-1) == "-")) {
			res[n.id.slice(0,-1)] = n;
			n.id += new_extension;
		}

		adapt_nodes(n.childNodes, new_extension, res);
	});
	return res;
}

function round(v,n) {
	const factor = 10**n;
	return Math.round(v*factor)/factor;
}

function unpack_value(value) {
	const vals = value.trim().split(/\s+/);
	const res  = vals.map( val => {
		const res = { raw: val };
		// check if value begins with a number
		const number = val.match(/([+-]?[0-9]*(\.[0-9]+)?)([eE][+-]?\d+)?/)[0];
		if ((number == undefined) || (number.length < 1))
			return res;
		res.number = +number;
		// try to extract multiplier and unit
		const [_, mult, unit] = val.match(/([GMkmuµnp]?)((ppm)|[\%VAWFHRΩ]?)$/);
		if ((mult != undefined) && (mult.length > 0))
			res.mult = mult;
		if ((unit != undefined) && (unit.length > 0))
			res.unit = unit;
		return res;
	});
	//console.log(vals, res);
	return res;
}

function compare_number(p1, p2, op) {
	const exp = {
		"G"  :   9,
		"M"  :   6,
		"k"  :   3,
		""   :   0,
		"m"  :  -3,
		"u"  :  -6,
		"µ"  :  -6,
		"n"  :  -9,
		"p"  : -12,
	};
	const comp_func = {
		"==" : (a,b) => Math.abs(a-b) < 1e-12,
		">=" : (a,b) => a >= b,
		"<=" : (a,b) => a <= b,
	};
	const exp1 = exp[p1.mult ?? ""];
	const exp2 = exp[p2.mult ?? ""];
	const num1 = p1.number * 10**exp1;
	const num2 = p2.number * 10**exp2;
	const res  = comp_func[op](num1, num2);
	//console.log(res, p1.number, p1.mult, p2.number, p2.mult, num1, num2);
	return res;
}

const equiv_units  = { "R" : "Ω", "Ω" : "R" };

function same_units(a, b, unit_optional) {
	return (a.unit == b.unit) || (equiv_units[a.unit] == b.unit) ||
		((unit_optional === true) && ((a.unit == undefined) || (b.unit == undefined)) );
}

// units V A W F H R/Ω   >=  (rating)
// units % ppm           <=  (tolerance)
function match_param(req_parm, feeder_parms, comp_designator) {
	const compare_ops  = {
		R : { V:">=", A:">=", W:">=", "%":"<=", ppm:"<=" },
		C : { V:">=", "%":"<=" },
		L : { A:">=", "%":"<=" },
	};
	const compare_op = compare_ops[comp_designator]?.[req_parm.unit] ?? 
	                   compare_ops[comp_designator]?.[equiv_units[req_parm.unit]];

	// match raw value exactly for unknown units
	if ((req_parm.unit == undefined) || (compare_op == undefined))
		return feeder_parms.some(fp => fp.raw == req_parm.raw);

	// otherwise find same unit and apply comparison operator
	return feeder_parms.some(fp => 
		same_units(fp, req_parm) && compare_number(fp, req_parm, compare_op));
}

function assign_component(feeders, comp) {

	return feeders.findIndex( feeder => {

		// 1) find footprint in feeder note
		if (!feeder.Note.includes(comp.fp))
			return false;

		const params         = comp.params;

		// 2) match 1st (primary) value exactly (==) (with multiplier conversion)
		//    unit is optional for primary value (because footprints are named C_0603/L_0603/R_0402/...)
		//    but if primary value of both component and feeder have a unit they must match
		if (!(same_units(feeder.params[0], params[0], true) && compare_number(feeder.params[0], params[0], "==")))
			return false;

		// 3) walk through list of remaining component values:
		//    + match tolerances     (<=)
		//    + match ratings        (>=)
		//    + match unknown types  exactly
		for (let idx=1; idx<params.length; idx++) {
			if(!match_param(params[idx], feeder.params, comp.designator))
				return false;
		}

		//console.log(part_desc, comp_footprint,comp_val, found);
		return true;
	});
}

/* Feeders:
 *  1-29: left side reels
 *     1-22:  8mm
 *    23-26: 12mm
 *    27-28: 16mm
 *       29: 24mm
 * 60-73: front bulk IC tray
 *    60-66: 2nd row (smaller pockets)
 *    67-72: 1st row (larger pockets)
 *       73: long pocket right of 1st/2nd row
 * 74-79: front left - vibration feeders
 * 80-99: IC trays
 *
 * ICTray table will be empty unless feeder IDs >= 80 are defined
 */

function gather_fiducials() {
	let res = [];
	for(let idx=0; idx<assignments.Fiducial.length; idx++) {
		const fid       = assignments.Fiducial[idx];
		const [x,y,rot] = getpos_pnp(fid.kicad_pos, 0);
		res.push({
			"No."     : idx,
			"ID"      : idx+1,
			"offsetX" : x,
			"offsetY" : y,
			"Note"    : fid.ref
		});
	}
	return res;
}

function export_assignment(idx, component, feeder, nozzle) {
	const ctl          = component.ctl_nodes;
	const place        = ctl.place.checked;
	if(!place)
		return;
	const flags        = (!place) + (ctl.vacuum.checked * 2) + (ctl.vision.checked * 4);
	const [x,y,rot]    = getpos_pnp(component.kicad_pos, feeder.ext_params.orientation);
	return {
		"No."      : idx,
		"ID"       : idx+1,
		"PHead"    : nozzle,
		"STNo."    : feeder.ID,
		"DeltX"    : x,
		"DeltY"    : y,
		"Angle"    : rot,
		"Height"   : feeder.Height, // TBD: board height??
		"Skip"     : flags,
		"Speed"    : 0, // 0: use global default
		"Explain"  : component.ref,
		"Note"     : component.val,
	};
}

function make_DPV_table_entries(table, entries) {
	let res="";
	// for each table entry (optimized for speed - not using reduce)
	for(let i=0; i<entries.length; i++) {
		const entry = entries[i];
		res+=table.table; // add table name as 1st field
		// for each field of table entry
		for(let fi=1; fi<table.fields.length; fi++) {
			const field = table.fields[fi];
			res += "," + ((entry[field] ?? "0")+"").replaceAll(",",".");
		}
		res+=lf;
	}
	return res;
}

function make_pnp_list(tbl) {
	const assigned   = Object.entries(assignments);
	let component_id = 0;
	let res          = "";

	// for each feeder with assigned components:
	for(let aidx=0; aidx<assigned.length; aidx++) {
		const [feeder_idx, components] = assigned[aidx];

		if(isNaN(feeder_idx))
			continue;

		const feeder = dpv_reference.tables.Station[feeder_idx]; // {No.: '3', ID: '5', DeltX: '-1.14', ...}
		const nozzle = feeder?.ext_params.nozzle;

		// for each component for current feeder
		for(let cidx=0; cidx<components.length; cidx++) {
			const component = components[cidx];
			const exported  = export_assignment(component_id, component, feeder, nozzle);
			if (exported == null) continue;
			res += make_DPV_table_entries(tbl, [exported]);
			component_id++;
		}

	} // foreach assignment entry (feeder)

	return res;
}

function digits(v,n) {
	for(let i=(v+"").length;i<n;i++)
		v = "0"+v;
	return v;
}

function make_dpv(fname) {
	const now = new Date();
	const header = [
		["FILE"    , fname                                ],
		["PCBFILE" , pcb.filename                         ],
		["DATE"    , now.getFullYear()+"/"+digits(now.getMonth()+1,2)+"/"+digits(now.getDate(),2) ],
		["TIME"    , now.toTimeString().match(/^\S+/)[0]  ],
		["PANELYPE", "0"                                  ], // typo needed...
	];
	const table_constructors = {
		// feeders - copy from reference
		Station     : t => make_DPV_table_entries(t,dpv_reference.tables.Station),

		// IC Trays (and cut tapes) - copy from reference
		ICTray      : t => make_DPV_table_entries(t,dpv_reference.tables.ICTray),

		// "batch" type panel - i.e. same Y for all PCBs
		Panel_Coord : t => make_DPV_table_entries(t,[{ID:1}]),

		// components to be placed
		EComponent  : make_pnp_list,

		/* Calibration information
		 * nType     : 0 -> components, 1 -> fiducials
		 * nFinished : 0 -> not calibrated, 1 -> calibrated */
		PcbCalib    : t => make_DPV_table_entries(t,[{nType : (assignments.Fiducial.length > 1) ? 1 : 0}]),

		// fiducials / calibration points
		CalibPoint  : t => make_DPV_table_entries(t,gather_fiducials()),

		// calibration factors (typo needed!) - zeroes will do, determined during calibration
		CalibFator  : t => make_DPV_table_entries(t,[{}]),
	};

	// make file header
	let buf = header.reduce( (res, [id, val]) =>
		res + id + "," + (val+"").replaceAll(",","") + lf, "separated"+lf) + lf;

	// make tables
	buf = dpv_reference.table_templates.reduce( (res, table) => {
		const name   = table.table;
		const fields = table.fields;
		// put table header
		res += fields.join(",") + lf;
		// put table contents
		res += (name != null) ? table_constructors[name](table) : "";
		res += lf;
		return res;
	}, buf);

	//console.log(buf);
	return buf;
}

async function dpv_download() {
	const fname  = pcb.filename.replaceAll(".kicad_pcb","-"+pcb_side+".dpv");
	const blobby = new Blob([make_dpv(fname)], {type: "text/plain"});

	if (window.showSaveFilePicker != null) {
		const fileHandle = await window.showSaveFilePicker({
			startIn: 'desktop',
			suggestedName: fname,
			types: [{
				description: 'Pick&Place file',
				accept: { 'text/plain': ['.dpv'] },
			}],
		});
		const fileStream = await fileHandle.createWritable();
		await fileStream.write(blobby);
		await fileStream.close();
	} else { // window.showSaveFilePicker not available
		const    a = document.createElement("a");
		a.href     = window.URL.createObjectURL(blobby);
		a.download = fname;
		a.click();
		URL.revokeObjectURL(a.href);
	}
}

var getpos_pnp     = null; // function pointer for pnp position conversion
var getpos_display = null; // function pointer for display position conversion

var ctl_template = null;

/* TODOs:
 * - PCB height
 * - centroid correction points?
 * - ICTray configuration?
 * - batch / array mode?
 */

function toggle_selection(arr, idx, ctl_type, inc) {
	for(;arr[idx] != null;idx+=inc)
		arr[idx].ctl_nodes[ctl_type].checked ^= 1;
}

function placement_cfg_all(evt) {
	const place = evt.target.id == "place_all";
	if(!assignments) return;
	Object.values(assignments).forEach( components =>
		components.forEach(comp => {
			if(comp.ctl_nodes?.place)
				comp.ctl_nodes.place.checked = place;
		})
	);
}

function make_control(cell,comp,ctl_type,idx,arr) {
	let ctl          = ctl_template.cloneNode(true);
	let ctl_nodes    = adapt_nodes([ctl], ctl_type+"."+comp.ref);

	ctl_nodes.ctl_down.addEventListener('click', e => toggle_selection(arr, idx, ctl_type,  1));
	ctl_nodes.ctl_up.addEventListener(  'click', e => toggle_selection(arr, idx, ctl_type, -1));

	comp.ctl_nodes ??= {};
	comp.ctl_nodes[ctl_type] = ctl_nodes.ctl_check;

	cell.appendChild(ctl);
}

const populate_cell = {
	place     : (c,inst,idx,arr)        => make_control(c, inst, "place", idx, arr),
	id        : (c,inst)                => c.textContent = inst.ref,
	value     : (c,inst)                => c.textContent = inst.val,
	fp        : (c,inst)                => c.textContent = inst.fp,
	x         : (c,inst,idx,arr,feeder) => c.textContent = round(getpos_display(inst.kicad_pos, feeder?.ext_params.orientation ?? 0)[0], precision),
	y         : (c,inst,idx,arr,feeder) => c.textContent = round(getpos_display(inst.kicad_pos, feeder?.ext_params.orientation ?? 0)[1], precision),
	rot       : (c,inst,idx,arr,feeder) => c.textContent = round(getpos_display(inst.kicad_pos, feeder?.ext_params.orientation ?? 0)[2], precision) + "°",
	td_vision : (c,inst,idx,arr)        => make_control(c, inst, "vision", idx, arr),
	td_vacuum : (c,inst,idx,arr)        => make_control(c, inst, "vacuum", idx, arr),
}

var card_template = null;

function make_component_card(target, feeder_idx, feeder, show_unused) {
	const instances  =  assignments[feeder_idx] ?? [];
	const unused     = !(instances.length > 0);
	if(unused && (!show_unused))
		return;

	const name            = (feeder != undefined) ? ("Feeder " + feeder.ID) : feeder_idx;
	const desc            = feeder?.Note;
	const orientation     = feeder?.ext_params.orientation;
	const nozzle          = feeder?.ext_params.nozzle;

	let card  = card_template.cloneNode(true);
	let nodes = adapt_nodes([card], name);

	nodes.comp_name.textContent         = name + (desc ? ":" : "");
	nodes.comp_desc.textContent         = desc ?? "";
	nodes.comp_orientation.textContent  = (orientation != null) ? ("∠: "+orientation+"° ") : "";
	nodes.comp_nozzle.textContent       = nozzle ? ("Nozzle: " + nozzle) : "";

	// vision and vacuum indicators
	if(feeder) {
		// TODO: verify
		const vision_en = feeder.Status & 4;
		const vacuum_en = feeder.Status & 2;
		nodes.comp_vision.hidden = !vision_en;
		nodes.comp_vacuum.hidden = !vacuum_en;
	}

	nodes.comp_table.hidden     =  unused;
	nodes.comp_none.hidden      = !unused;

	const table_cells = {
		Fiducial      : ["id","x","y"],
		Indeterminate : ["id","value","fp","x","y","rot"],
	}[feeder_idx] ?? ["place", "id", "value", "x", "y", "rot", "td_vision", "td_vacuum"];

	table_cells.forEach( cid => nodes["comp_"+cid].hidden = false );

	// iterate over all parts for this feeder
	instances.forEach( (instance, idx, arr) => {
		let row = nodes.comp_tbody.insertRow(-1);
		// iterate over all cells for this table row
		table_cells.forEach( cid => {
			const cell = row.insertCell(-1);
			populate_cell[cid](cell, instance, idx, arr, feeder);
		});
	});
	target.appendChild(card);
}

function update_tooltips() {
	const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
	const tooltipList = [...tooltipTriggerList].map(elem => bootstrap.Tooltip.getOrCreateInstance(elem));
}

function redraw_list() {
	// origin select
	const origin_sel = document.querySelector('input[name="origin_select"]:checked').value;
	getpos_display   = (origin_sel == "kicad") ?
		( kicad_pos => [kicad_pos.x, kicad_pos.y, kicad_pos.rot] ) : getpos_pnp;

	// show unused?
	const show_unused = document.getElementById('show_unused').checked;

	const target      = document.getElementById('assignments');
	target.replaceChildren();

	// make fiducial card
	make_component_card(target, "Fiducial", null, show_unused);

	// walk through list of feeders
	Object.entries(dpv_reference?.tables?.Station ?? []).forEach( ([feeder_idx, feeder]) =>
		make_component_card(target, feeder_idx, feeder, show_unused));

	// make card for indeterminate (unassigned) components
	make_component_card(target, "Indeterminate", null, show_unused);
	update_tooltips();
}

function get_extents(pcb) {
	const [lower_left, upper_right] = pcb.reduce( ([ll,ur],elem) => {
		/* find Edge.Cuts lines */
		if( (elem[0] == "gr_line") && (elem.find(se => (se[0] == "layer") && (se[1] == '"Edge.Cuts"'))) ) {
			const start = elem.find(se => se[0] == "start");
			const end   = elem.find(se => se[0] == "end");
			// lower left
			ll.x = Math.min(ll.x, start[1]);
			ll.x = Math.min(ll.x, end[1]);
			ll.y = Math.max(ll.y, start[2]);
			ll.y = Math.max(ll.y, end[2]);
			// upper right
			ur.x = Math.max(ur.x, start[1]);
			ur.x = Math.max(ur.x, end[1]);
			ur.y = Math.min(ur.y, start[2]);
			ur.y = Math.min(ur.y, end[2]);
			//console.log("found",elem,start,end);
		}
		return [ll,ur];
	}, [{x:Infinity, y:-Infinity}, {x:-Infinity, y:Infinity}]);
	//console.log("extents:",lower_left,upper_right);
	const size = {w:round(upper_right.x-lower_left.x,3), h:round(lower_left.y-upper_right.y,3)}; // use precision 3 for reference point / size
	return {ll:lower_left, ur:upper_right, size:size};
}

function get_footprints(pcb) {
	return pcb.reduce( (res, elem) => {
		if( (elem[0] == "footprint") && (elem.find(se => (se[0] == "attr") && (se[1] == "smd"))) ) {
			let tmp     = JSON.parse(elem[1]);
			const fp    = tmp.substring(tmp.indexOf(":")+1);
			const side  = elem.find(se => (se[0] == "layer") && (se[1] == '"F.Cu"')) ? "top" : "bot";
			const pos   = elem.find(se => se[0] == "at");
			const ref   = JSON.parse(elem.find(se => (se[0] == "fp_text") && (se[1] == "reference"))[2]);
			const val   = JSON.parse(elem.find(se => (se[0] == "fp_text") && (se[1] == "value"))[2]);
			let [_, designator, idx] = ref.match(/^(\D+)(\d+)/);
			idx = +idx;
			const component = {
				ref        : ref,
				val        : val,
				fp         : fp,
				side       : side,
				designator : designator,
				idx        : idx,
				kicad_pos  : {x:pos[1], y:pos[2], rot:(pos[3] ?? 0)},
				params     : unpack_value(val),
			}
			res[designator]??=[];
			let  t = res[designator];
			t[idx] = component;
			//console.log(designator, idx, typeof(idx), component);
		}
		return res;
	}, []);
}

function analyze_pcb(raw_pcb) {
	let extents     = get_extents(raw_pcb);

	// aux/pnp origin
	const setup     = raw_pcb.find(e => e[0] == "setup");
	let aux_origin  = null;
	if (setup) {
		const aux = setup.find(e => e[0] == "aux_axis_origin");
		if (aux) {
			aux_origin = {
				x        : aux[1],
				y        : aux[2],
				explicit : true,
			};
		}
	}
	aux_origin ??= {
		x        : extents.ll.x,
		y        : extents.ll.y,
		explicit : false,
	};

	// footprints
	let footprints = get_footprints(raw_pcb);

	return {
		raw_pcb    : raw_pcb,
		extents    : extents,
		footprints : footprints,
		aux_origin : aux_origin,
	};
}

function fixup_rotation(rot) {
	rot += (rot < -180) ? 360 : 0;
	rot -= (rot >= 180) ? 360 : 0;
	return rot;
}

function setup_pos_conversion(side_sel, aux_origin, extents) {
	if(aux_origin == undefined)
		return null;
	//console.log(side_sel, aux_origin);
	return {
		"top" : ( (kicad_pos, feeder_orientation) => [
			round(kicad_pos.x - aux_origin.x, precision),
			round(aux_origin.y - kicad_pos.y, precision),
			round(fixup_rotation(kicad_pos.rot - feeder_orientation), precision)
		]),
		"bot_hflip" : ( (kicad_pos, feeder_orientation) => [
			round(extents.size.w - (kicad_pos.x - aux_origin.x), precision),
			round(aux_origin.y - kicad_pos.y, precision),
			round(fixup_rotation(180 - kicad_pos.rot - feeder_orientation), precision)
		]),
		"bot_vflip" : ( (kicad_pos, feeder_orientation) => [
			round(kicad_pos.x - aux_origin.x, precision),
			round(extents.size.h - aux_origin.y + kicad_pos.y, precision),
			round(fixup_rotation(180 - kicad_pos.rot + feeder_orientation), precision)
		])
	}[side_sel];
}

function assign_components(dpv, pcb) {
	const side_sel      = document.querySelector('input[name="side_select"]:checked').value;
	const [side]        = side_sel.match(/[^_]+/);

	pcb_side   = side_sel;
	getpos_pnp = setup_pos_conversion(side_sel, pcb?.aux_origin, pcb?.extents);

	const feeders = dpv?.tables?.Station ?? [];
	let list = {
		"Fiducial"      : [],
		"Indeterminate" : [],
	};
	if(pcb && pcb.footprints) {
		Object.entries(pcb.footprints).flatMap(v => v[1]).forEach(comp => {
			if(comp.side == side) {
				let target = list.Indeterminate;
				if(comp.val == "Fiducial")
					target = list.Fiducial;
				else if (feeders.length) {
					const feeder_idx = assign_component(feeders, comp);
					target = (feeder_idx >= 0) ? (list[feeder_idx]??=[]) : list.Indeterminate;
				}
				target.push(comp);
			}
		});
	}
	return list;
}

function update_gimme_btn() {
	const disclaimer_ok = document.getElementById('disclaimer_accept').checked;
	document.getElementById('gimme_dpv').disabled = (!disclaimer_ok) || (!Object.keys(assignments).some(e => !isNaN(e)));
}

function reassign_components() {
	assignments = assign_components(dpv_reference, pcb);
	update_gimme_btn();
	redraw_list();
}

function KicadLoader(str, fname, server_path, mod_time) {
	//const start = performance.now();
	let raw_pcb = parse_sexpression(str);
	//console.log(performance.now() - start);
	pcb         = analyze_pcb(raw_pcb);
	if(pcb)
		pcb.filename = fname;

	document.getElementById('pnp_origin').textContent =
		pcb.aux_origin.x+", "+pcb.aux_origin.y +
		(pcb.aux_origin.explicit ?
		" (aux axis origin)" : " (lower left corner)");

	document.getElementById('pcb_size').textContent =
		pcb.extents.size.w + " x " + pcb.extents.size.h + " mm";

	const kicad_version    = (pcb.raw_pcb?.[1]?.[0] == "version") ? pcb.raw_pcb?.[1]?.[1] : "unknown";
	const kicad_version_ok = !isNaN(kicad_version) && (+kicad_version >= required_kicad_version[0]) && (+kicad_version <= required_kicad_version[1]);

	const kv_node          = document.getElementById('kicad_version');
	kv_node.textContent    = kicad_version;
	kv_node.style.color    = "rgb(var(--bs-" + (kicad_version_ok ? "success" : "warning") + "-rgb))";
	document.getElementById('kicad_version_warning').hidden = kicad_version_ok;

	const remote         = server_path != null;
	const pcb_link       = document.getElementById('pcb_link');
	const kicad_filename = document.getElementById('kicad_filename');
	const reload_btn     = document.getElementById('reload_pcb');
	const mtime          = document.getElementById('kicad_date');

	pcb_link.href               = remote ? server_path : "#";
	pcb_link.textContent        = server_path;
	pcb_link.hidden             = !remote;
	kicad_filename.textContent  = remote ? " (from server)" : (fname + " (local file)");
	reload_btn.hidden           = !remote;
	mtime.textContent           = mod_time ?? "";

	reassign_components();
}

// this is a very simple (but fast) CSV parser
// it doesn't support escaped commas or quotes
function simple_CSV_parser(str, delim, skip_empty){
	const keep_empty = (skip_empty !== true);
	delim          ??= ',';
	let list         = [];
	let res          = [];
	let idx          = 0;

	for (let j = 0; j < str.length; j++) {
		const c  = str[j];

		switch(c) {
			case "\r": // skip CR
				break;

			case "\n": // newline
				if (keep_empty || (list.length > 0))
					res.push(list);
				list = [];
				idx  = 0;
				break;

			case delim: // delimiter
				list[++idx] = "";
				break;

			default:
				list[idx] = (list[idx] ?? "") + c;
		} // switch
	} // for

	// final non-empty but no newline?
	if (list.length > 0)
		res.push(list);

	return res;
}

function DpvLoader(str, fname) {
	dpv_reference = null;
	// the Charmhigh software doesn't honor quotes or escaped commas
	// therefore we can use a very simple CSV parser
	const raw_dpv = (str != null) ? simple_CSV_parser(str, ",", true) : null;
	if (!raw_dpv) {
		reassign_components();
		return;
	}

	let tables          = [];
	let table_templates = [];
	let table_def       = null;

	/* extract tables */
	raw_dpv.forEach( line => {
		// table header
		if(line[0]=="Table") {
			table_def = line;
			table_templates.push({table : null, fields: table_def});
		}
		// table content
		else if ((line[0]) && (table_def)) {
			let name      = line[0];
			let tbl_entry = {};
			table_templates[table_templates.length-1].table??=name;  // set table name if not yet done
			for (i=1;i<line.length;i++) {                            // collect & assign fields
				let key         = table_def[i];
				tbl_entry[key]  = line[i];
			}
			tables[name] ??= [];
			tables[name].push(tbl_entry);
		}
	});

	const default_values = {
		nozzle      :   1,
		orientation : +90, // "normal" orientation for reel feeders
	};

	// extract inline params from feeder notes
	tables.Station?.forEach( feeder => {
		feeder.params                 = unpack_value(feeder.Note);
		// extended params are named params with key:value pattern
		feeder.ext_params             = {...default_values};
		feeder.ext_params.orientation = (+feeder.ID < 60) ? default_values.orientation : 0;  // use default orientation 0 for non-reel materials
		const matches     = feeder.Note.matchAll(/(\S+):(\S+)/g);
		for (const [_, key, value] of matches)
			feeder.ext_params[key]  = isNaN(value) ? value : +value;
	});

	dpv_reference = {
		raw_dpv         : raw_dpv,
		table_templates : table_templates,
		tables          : tables,
		filename        : fname,
		user_selected   : fname != null,
	}

	document.getElementById('dpv_filename').textContent = 
		raw_dpv.find( v => v[0] == "FILE")?.[1] + " " + (dpv_reference.user_selected ? "(local file)" : "(last used)");
	const dpv_date = raw_dpv.find( v => v[0] == "DATE")?.[1];
	const dpv_time = raw_dpv.find( v => v[0] == "TIME")?.[1];
	document.getElementById('dpv_date').textContent = dpv_date + " " + dpv_time;

	if(dpv_reference.user_selected)
		localStorage.setItem("last_dpv", str);

	reassign_components();
}

function fileReader(e, loader) {
	const file = e.target.files[0];
	if (!file) return;
	let reader = new FileReader();
	reader.onload = evt => loader(evt.target.result, file.name);
	reader.readAsText(file);
}

/* server PCBs interface */

function get_pcb(e) {
	selected_pcb        = e;
	const full_path     = "/pcbs/"+e.Path;
	let last_modified   = null;
	//console.log(path, fname);

	fetch(full_path, { cache: "no-store" }).then( (response) => {
		if(!response.ok)
			throw new Error("fetch fail");
		last_modified = new Date(response.headers.get('Last-Modified'));
		return response.text();
	}).then( (result) => {
		if(result.stat === "fail")
			throw new Error(result.message);
		e.ModTime = last_modified;
		KicadLoader(result, e.Fname, full_path, e.ModTime.toLocaleString());
	  }).catch( (err) => {console.log(err)});
	const modal = bootstrap.Modal.getInstance("#server_pcbs_modal");
    modal?.hide();
	return false;
}

let pcbs_sort_key     = "ModTime";
let pcbs_sort_dir_inv = true;

function update_pcbs_list() {
	pcbs_list.sort( (a,b) => {
		const [x, y] = pcbs_sort_dir_inv ? [b[pcbs_sort_key], a[pcbs_sort_key]] : [a[pcbs_sort_key], b[pcbs_sort_key]];
		return pcbs_sort_key != "ModTime" ? x.localeCompare(y) : x.getTime()-y.getTime();
	});
	const target      = document.getElementById('pcbs_list');
	target.replaceChildren();
	pcbs_list.forEach( e => {
		let row  = target.insertRow(-1);
		let cell = [];
		for (let i=0;i<3;i++) {
			cell[i] = row.insertCell(-1);
		}
		const anchor = document.createElement("a");
		anchor.href = '#';
		anchor.onclick = evt => get_pcb(e);
		anchor.textContent  = e.Fname;
		cell[0].appendChild(anchor);
		cell[1].textContent = e.ModTime.toLocaleString();
		cell[2].textContent = e.Dir;
	});
}

function change_pcbs_sort_order(id) {
	const key         = id.match(/_(\S+)/)[1];
	pcbs_sort_dir_inv = (key == pcbs_sort_key) ? !pcbs_sort_dir_inv : false;
	pcbs_sort_key     = key;
	update_pcbs_list();
}

function expand_pcbs_list(l) {
	return l.map(e => {
		const [_, dir, fname] = e.Path.match(/(^\S+\/)?([^/]+)/);
		return {
			Path    : e.Path,
			ModTime : new Date(e.ModTime),
			Fname   : fname,
			Dir     : dir
		};
	});
}

function pcbs_server_refresh(no_refresh) {
	const req = '/pcbs/' + ((no_refresh === true) ? "" : "?refresh");
	fetch(req, { cache: "no-store" }).then( (response) => {
		if(!response.ok)
			throw new Error("fetch fail");
		return response.json();
	}).then( (result) => {
		if(result.stat === "fail")
			throw new Error(result.message);
		const pcbs_server_btn = document.getElementById('pcbs_server');
		// initial test succeeded -> enable server button and prepare modal
		if(pcbs_server_btn.hidden) {
			const modal_label       = document.getElementById('ModalLabel');
			modal_label.textContent = "KiCad PCBs @" + document.location.host + ":";
			pcbs_server_btn.hidden  = false;
		}
		else { // not initial test but a refresh -> modal and server button already active
			pcbs_list = expand_pcbs_list(result);
			update_pcbs_list();
		}
	  }).catch( (err) => {console.log(err)});
}

document.addEventListener("DOMContentLoaded", function() {
	ctl_template  = document.getElementById('ctl-');
	card_template = document.getElementById('component_card-');

	// attempt to get a list of PCBs from server - if successful unhide "fetch from server" button
	pcbs_server_refresh(true);

	// load last DPV (if any) - will trigger a reassign_components + redraw in any case
	DpvLoader(localStorage.getItem("last_dpv"));

	// register various event handlers
	document.getElementById('kicad_file').addEventListener('change', e => fileReader(e,KicadLoader), false);
	document.getElementById('dpv_file').addEventListener('change',   e => fileReader(e,DpvLoader),   false);
	document.querySelectorAll('input[name="side_select"]').forEach(n => n.addEventListener('change', reassign_components));
	document.querySelectorAll('input[name="origin_select"]').forEach(n => n.addEventListener('change', redraw_list));
	document.getElementById('show_unused').addEventListener('change', redraw_list);
	document.getElementById('place_all').addEventListener('click', placement_cfg_all);
	document.getElementById('place_none').addEventListener('click', placement_cfg_all);
	document.getElementById('gimme_dpv').addEventListener('click', dpv_download);
	document.getElementById('refresh_server_pcbs').addEventListener('click', pcbs_server_refresh);
	document.getElementById('server_pcbs_modal').addEventListener('show.bs.modal', pcbs_server_refresh);
	document.querySelectorAll("[id^='sort_']").forEach(n => n.addEventListener('click', evt => change_pcbs_sort_order(n.id)));
	document.getElementById('reload_pcb').addEventListener('click', e => get_pcb(selected_pcb));
	document.getElementById('no_SaveFilePicker').hidden = (window.showSaveFilePicker != null);
	document.getElementById('disclaimer_accept').addEventListener('change', e => {
		document.getElementById('disclaimer_notice').hidden = e.target.checked;
		update_gimme_btn();
	});

	// devmode stuff
	if(localStorage.getItem('devmode') == 'shibboleet') {
		document.querySelectorAll("[class~='devmode-enable']").forEach(n => n.disabled = false);
		document.querySelectorAll("[class~='devmode-hide']").forEach(  n => n.hidden   = true);
		document.querySelectorAll("[class~='devmode-unhide']").forEach(n => n.hidden   = false);
		document.querySelectorAll("[class~='devmode-check']").forEach( n => {
			n.checked  = true;
			n.dispatchEvent(new Event('change'));
		});
	}

	update_tooltips();

	// sprinkle all suitable nodes with the current version
	document.querySelectorAll("[id^='version-']").forEach(n => n.textContent = "v" + version);

	// release notes
	document.getElementById('release_notes').hidden = localStorage.getItem('hide_relnotes') == version;
	document.getElementById('hide_relnotes').addEventListener('change', e => {
		if(!e.target.checked) return;
		localStorage.setItem('hide_relnotes', version);
		document.getElementById('release_notes').hidden = true;
	});

});
