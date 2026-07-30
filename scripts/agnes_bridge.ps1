$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$headers = @{ Accept = 'application/json' }
if ($request.authorization) { $headers.Authorization = $request.authorization }
$params = @{
  Uri = $request.url
  Method = $request.method
  Headers = $headers
  TimeoutSec = 120
  UseBasicParsing = $true
}
if ($request.body) {
  $params.ContentType = 'application/json; charset=utf-8'
  $params.Body = [System.Text.Encoding]::UTF8.GetBytes($request.body)
}

try {
  $response = Invoke-WebRequest @params
  [Console]::Out.Write($response.Content)
} catch {
  $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 500 }
  $detail = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  [Console]::Error.Write(([pscustomobject]@{ status = $status; message = $detail } | ConvertTo-Json -Compress))
  exit 1
}
