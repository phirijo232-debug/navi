#!/usr/bin/env python3
import re

with open('c:\\NaviServer\\controllers\\loanController.js', 'r') as f:
    content = f.read()

# Fix the join escape sequences - these cause Node.js syntax errors
# Pattern: }).join('\\\\n') should become }).join('\n')
# Pattern: ).join('\\n') should become ).join('\n')

# Replace quadruple backslash-n with single backslash-n
content = content.replace('\\\\\\\\n', '\\n')

# Replace double backslash-n followed by ) or ; with single backslash-n  
content = content.replace('\\\\n(?=\\))', '\\n')
content = content = content.replace('\\\\n(?=;)', '\\n')

with open('c:\\NaviServer\\controllers\\loanController.js', 'w') as f:
    f.write(content)

print('Fixed escape sequences in loanController.js')