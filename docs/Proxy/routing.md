Proxy Server (OPTiCS-Hub/proxy/server.ts)
Request validation
- host exist?
- is optics domain?

Current request flow
Client -> CF Edge -> Gateway(Proxy/Tunnel) -> Stand by > Piping
                            > Hub -> Agent -> Tunnel ^

Planning request flow
Clinet -> CF Edge -> Gateway(Proxy/Tunnel) -> Agent -> Piping
Let gateway have connection pool

which data should be needed to make agent connection pool?
- service and workspace subdomain

does agent has it?
-> Nope. agent has only one time connection token
-> Hub should return registered subdomain for Agent

Parse host from request -> Already parsing

Find subdomain from agentConnectionPool
if doesn't exist, then request to hub
if exist, pipe

Registry should have UUID and Host SET
- Remove waiting agent latancy
- Estimated improvement is reduce of ~200ms of request latancy
