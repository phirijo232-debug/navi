import re
import os

filepath = r'c:\NaviServer\controllers\loanController.js'
with open(filepath, 'r', encoding='utf8') as f:
    content = f.read()

# Replace all instances of \\n (literal backslash-n) with \n (newline)
# We need to replace the double backslash followed by n
content = content.replace('\\\\n', '\\n')

with open(filepath, 'w', encoding='utf8') as f:
    f.write(content)

print(f'Fixed escape sequences in {filepath}')