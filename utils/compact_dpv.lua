#!/usr/bin/lua

function compact_file(fn)
	local fh = io.open(fn,"r")
	local res = ""
	for line in fh:lines() do
		if #line > 1 then
			if line:sub(0,6) == "Table," then 
				res = res .. "\r\n" end
			res = res .. line .. "\n"
		end
	end
	--print(res)
	fh:close()
	fh = io.open(fn,"w")
	fh:write(res);
	fh:close()
end

for i=1,#arg do
	local fn = arg[i]
	compact_file(fn)
end
