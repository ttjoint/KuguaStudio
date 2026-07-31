with open(r'd:\Projects\KuguaStudio\packages\gui\src\renderer\index.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_text = '''  数据库大小: number;
}

interface 资源详情 {'''

new_text = '''  数据库大小: number;
}

interface 资源 {
  id: number;
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  modifiedTime: number;
  snippet?: string;
}

interface 资源详情 {'''

if old_text in content:
    content = content.replace(old_text, new_text)
    with open(r'd:\Projects\KuguaStudio\packages\gui\src\renderer\index.ts', 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print('Fixed: added 资源 interface')
else:
    print('Pattern not found, checking...')
    # Find where 知识库统计 ends
    idx = content.find('interface 资源详情')
    if idx != -1:
        print(f'Found 资源详情 at position {idx}')
        print('Context around that position:')
        print(repr(content[idx-100:idx+50]))
