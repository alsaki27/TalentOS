import json
import re

with open("src/lib/jobAgentRoleLibrary.ts", "r") as f:
    ts_content = f.read()

# Extract the ROLE_GROUPS JSON string
match = re.search(r"const ROLE_GROUPS:\s*RoleGroup\[\]\s*=\s*(\[.*?\]);", ts_content, re.DOTALL)
if match:
    groups_str = match.group(1)
    
    # We need to parse this JS array of objects into python.
    # Because it's not strictly JSON (missing quotes on keys, etc), we'll do a quick regex parse.
    import ast
    
    groups_str = re.sub(r'(\w+):', r'"\1":', groups_str)
    # Handle single quotes to double quotes if needed, but it already uses double quotes mostly.
    # Just eval it using JS-to-Python
    groups_str = groups_str.replace("'", '"')
    
    # Let's just write a regex extractor for each group
    
    groups = []
    for g_match in re.finditer(r'{\s*"id"\s*:\s*"([^"]+)",\s*"label"\s*:\s*"([^"]+)",\s*"resumeFamily"\s*:\s*"([^"]+)",\s*"titles"\s*:\s*\[(.*?)\]\s*,\s*}', groups_str, re.DOTALL):
        id_ = g_match.group(1)
        label = g_match.group(2)
        titles_str = g_match.group(4)
        titles = [t.strip().strip('"') for t in titles_str.split(',') if t.strip()]
        
        # We need to map bounded roots for A, B, C, K
        bounded = []
        if id_ == "A": bounded = ["osp", "ftth", "fttx"]
        elif id_ == "B": bounded = ["cad", "bim"]
        elif id_ == "C": bounded = ["gis"]
        elif id_ == "K": bounded = ["pv"]
        
        safe = [t.lower() for t in titles]
        
        groups.append({
            "id": id_,
            "label": label,
            "bounded": bounded,
            "safe": safe
        })
        
    # Write to a file
    with open("temp_dump.json", "w") as out:
        json.dump(groups, out, indent=2)
    print("Dumped groups to temp_dump.json")
