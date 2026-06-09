import base64, requests, json, time, os

vp = os.path.join(os.environ['TEMP'], 'video_tiny.mp4')
size = os.path.getsize(vp)/(1024*1024)
b64 = base64.b64encode(open(vp,'rb').read()).decode()
print(f'视频: {size:.1f}MB, base64: {len(b64)/(1024*1024):.1f}MB')

payload = {
    'model': 'gemini-3-flash-preview',
    'messages': [{
        'role': 'user',
        'content': [
            {'type': 'image_url', 'image_url': {'url': f'data:video/mp4;base64,{b64}'}},
            {'type': 'text', 'text': '用中文简要描述这个视频的内容，100字以内'}
        ]
    }],
    'max_tokens': 500
}
req_size = len(json.dumps(payload))/(1024*1024)
print(f'请求: {req_size:.1f}MB, 发送中...')

t0 = time.time()
r = requests.post('https://yyds.215.im/v1/chat/completions',
    headers={'Authorization': 'Bearer sk-RmQiGfVt3VSBwkuwo9qLq77wYr0oXgl6HHMeJeoZYxjyY8QB', 'Content-Type': 'application/json'},
    json=payload, timeout=180)
elapsed = time.time() - t0
print(f'状态: {r.status_code} ({elapsed:.1f}s)')

if r.status_code == 200:
    data = r.json()
    content = data['choices'][0]['message']['content']
    print(f'结果: {content}')
else:
    print(f'错误: {r.text[:500]}')
