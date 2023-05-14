/*
	BSD 2-Clause License

	Copyright (c) 2023 Benedikt Heinz <zn000h AT gmail.com>

	Redistribution and use in source and binary forms, with or without
	modification, are permitted provided that the following conditions are met:

	1. Redistributions of source code must retain the above copyright notice, this
	   list of conditions and the following disclaimer.

	2. Redistributions in binary form must reproduce the above copyright notice,
	   this list of conditions and the following disclaimer in the documentation
	   and/or other materials provided with the distribution.

	THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
	AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
	IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
	DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
	FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
	DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
	SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
	CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
	OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
	OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

/* speed optimized S-expression parser
 * parsing a ~2.2MByte KiCad PCB takes 100-150ms on a not-too-old computer
 *
 * strings in the result will have quotes ("") around them
 * escape sequences in strings are kept as they are
 * simple trick to decode strings in the results: use JSON.parse()
 *
 * Example:
 * parse_sexpression('(test foo "bar 23")') -> ["test","foo","\\"bar 23\\""]
 */
function parse_sexpression(str) {
	let stack  = [];
	let list   = [];
	let idx    = 0;
	let escape = false;
	let string = false;

	for (let j = 0; j < str.length; j++) {
		const c  = str[j];
		if (escape) {            // escaped char
			list[idx] = (list[idx] ?? "") + c;
			escape    = false;
		}
		else if (c == "\\") {     // escape
			if (string)
				list[idx] = (list[idx] ?? "") + c;   // keep escape symbol in string
			escape = true;
		}
		else if (string) {       // char of string
			list[idx] = (list[idx] ?? "") + c;
			string    = (c != "\"");
		}
		else if (c.charCodeAt(0) <= 0x20) {  // whitespace outside of string
			if(list[idx] == undefined) continue;
			if((!Array.isArray(list[idx])) && (!isNaN(list[idx])))     // convert last token to number if possible
				list[idx]=+list[idx];
			idx++;
		}
		else {                   // non-whitespace, not char of string, not an escaped char
			switch(c) {
				case '(':        // start of new list
					stack.push(list);
					idx      += (list[idx] != undefined);    // treat questionable expression '(a b(c d))' as if it were '(a b (c d))'
					list[idx] = [];
					list      = list[idx];
					idx       = 0;
					break;
				case ')':        // end of list
					if((!Array.isArray(list[idx])) && (!isNaN(list[idx])))     // convert last token to number if possible
						list[idx]=+list[idx];
					list = stack.pop();
					idx  = list.length;
					break;
				case '"':        // start of string
					string = true;   // no break here - keep strings enclosed in "" - payload (including unescape) can be extracted with JSON.parse()
				default:         // regular char
					list[idx] = (list[idx] ?? "") + c;
			}
		}
	}
	if (stack.length)
		throw new Error('S-Expression parse error');
	return list[0];
}
