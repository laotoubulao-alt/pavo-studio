$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add('http://127.0.0.1:8790/')
$listener.Start()
Write-Output 'Agnes bridge: http://127.0.0.1:8790'
while ($listener.IsListening) {
  $context = $listener.GetContext()
  try {
    $reader = [System.IO.StreamReader]::new($context.Request.InputStream, [System.Text.Encoding]::UTF8)
    $request = $reader.ReadToEnd() | ConvertFrom-Json
    $headers = @{ Accept = 'application/json' }
    if ($request.authorization) { $headers.Authorization = $request.authorization }
    $params = @{ Uri = $request.url; Method = $request.method; Headers = $headers; TimeoutSec = 120; UseBasicParsing = $true }
    if ($request.body) { $params.ContentType = 'application/json; charset=utf-8'; $params.Body = [System.Text.Encoding]::UTF8.GetBytes($request.body) }
    $upstream = Invoke-WebRequest @params
    $status = [int]$upstream.StatusCode
    $content = $upstream.Content
  } catch {
    $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 502 }
    $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    $content = @{ error = @{ message = $detail } } | ConvertTo-Json -Compress
  }
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
  $context.Response.StatusCode = $status
  $context.Response.ContentType = 'application/json; charset=utf-8'
  $context.Response.ContentLength64 = $bytes.Length
  $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $context.Response.Close()
}
