import re

with open('c:\\NaviServer\\controllers\\loanController.js', 'r') as f:
    content = f.read()

# Fix the join escape sequences - replace quadruple backslash-n with single backslash-n
# and double backslash-n with single backslash-n for join separators
content = content.replace("\\\\\\\\n", "\\\\n")  # quadruple -> double
content = content.replace("\\\\n", "\\n")      # double -> single

with open('c:\\NaviServer\\controllers\\loanController.js', 'w') as f:
    f.write(content)

print('Fixed escape sequences')