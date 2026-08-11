## 소켓 통신 계약

### Events | Hub → Agent 
| Event | Payload | Description |
|-------|---------|-------------|
| command | CommandPayload | DEPLOY/START/STOP 등 서비스 명령 |
| tunnel-connect | TunnelConnectPayload | Agent에 일회성 Reverse Tunnel 연결 요청 |

### Events | Agent → Hub
| Event | Payload | Description |
|-------|---------|-------------|
| register | RegisterPayload | Agent가 Hub에 자신을 등록 |
| service-log | ServiceLogPayload | 서비스 로그 전송 |
| service-status | ServiceStatusPayload | 서비스 상태 전송 |