---
title: Cilium forward to external address
description: Routing Cilium with Gateway API to an external, non-Kubernetes service without EndpointSlice
pubDate: 2026-07-29
---

In a Kubernetes Cluster environment the Cluster's CNI (Container Network Interface)
is network entry for all service traffic. In my case I use Cilium as CNI and had a
Home Assistant instance running in a VM, separate from Kubernetes.
Kubernetes was the entry for all traffic (basically a reverse proxy),
but redirecting the traffic to Home Assistant turned out to be not straightforward.

## The usual way

The "supported" way to point a Kubernetes Service at something outside the
cluster is to back it with a custom `EndpointSlice` that points directly at the
external IP address. In theory, this lets you treat an external service exactly
like an in-cluster pod: create a Service with no selector, create an
`EndpointSlice` by hand that lists the external endpoint, and then route to it
normally including through the Gateway API, via an `HTTPRoute` and Envoy.

This is appealing because it avoids extra hops: no forwarding pod,
no ExternalName DNS indirection, just a Service/EndpointSlice pair pointing
straight at the VM. Unfortunately, this is where I ran into a bug.

I opened a bug report for Cilium [at GitHub](https://github.com/cilium/cilium/issues/46798).

### What happened?

When exposing an external service (located on the same physical subnet as the cluster node) using a custom `EndpointSlice` and routing traffic to it via the Cilium Gateway API (Envoy), the connection fails with an HTTP `503 Service Unavailable` error.

Directly connecting to the external service from the host node or from an isolated standalone pod works perfectly. However, when traffic is routed through the Gateway API `HTTPRoute` targeting the `Service` backed by the external `EndpointSlice`, the TCP handshake never completes. Traffic analysis shows that the `SYN` packet leaves the host and the `SYN-ACK` returns and is successfully delivered back to the Envoy pod (`cilium_host -> cilium_net`), but the subsequent `ACK` packet to complete the handshake is never sent back out to the external server.

```sh
sudo tcpdump -i any port 8080
```

Output:

```
br0   Out IP 10.101.2.3.41571 > 10.101.2.7.8080: Flags [S], seq 143282964, win 64240, options [mss 1460,sackOK,TS val 1919551161 ecr 0,nop,wscale 10], length 0
enp1s0 Out IP 10.101.2.3.41571 > 10.101.2.7.8080: Flags [S], seq 143282964, win 64240, options [mss 1460,sackOK,TS val 1919551161 ecr 0,nop,wscale 10], length 0
enp1s0 P   IP 10.101.2.7.8080 > 10.101.2.3.41571: Flags [S.], seq 3260555409, ack 143282965, win 65160, options [mss 1460,sackOK,TS val 893433771 ecr 1919547028,nop,wscale 10], length 0
br0   In  IP 10.101.2.7.8080 > 10.101.2.3.41571: Flags [S.], seq 3260555409, ack 143282965, win 65160, options [mss 1460,sackOK,TS val 893433771 ecr 1919547028,nop,wscale 10], length 0
enp1s0 P   IP 10.101.2.7.8080 > 10.101.2.3.41571: Flags [S.], seq 3260555409, ack 143282965, win 65160, options [mss 1460,sackOK,TS val 893435832 ecr 1919547028,nop,wscale 10], length 0
br0   In  IP 10.101.2.7.8080 > 10.101.2.3.41571: Flags [S.], seq 3260555409, ack 143282965, win 65160, options [mss 1460,sackOK,TS val 893435832 ecr 1919547028,nop,wscale 10], length 0
# This repeated for a few milliseconds, the ack from 10.101.2.7:8080 is not recognised
cilium_host Out IP 10.101.2.7.8080 > 10.42.0.121.41571: Flags [S.], seq 3260555409, ack 143282965, win 65160, options [mss 1460,sackOK,TS val 893435832 ecr 1919547028,nop,wscale 10], length 0
cilium_net In  IP 10.101.2.7.8080 > 10.42.0.121.41571: Flags [S.], seq 3260555409, ack 143282965, win 65160, options [mss 1460,sackOK,TS val 893435832 ecr 1919547028,nop,wscale 10], length 0
# This repeated many times for a few milliseconds, I noticed that cilium is never sending something to 10.101.2.7:8080
```

In a new request this was recorded:

```sh
sudo conntrack -E -p tcp --reply-src 10.101.2.7
```

Output:

```
    [NEW] tcp      6 300 ESTABLISHED src=10.101.2.200 dst=10.101.2.7 sport=443 dport=38684 [UNREPLIED] src=10.101.2.7 dst=10.101.2.200 sport=38684 dport=443
 [UPDATE] tcp      6 300 src=10.101.2.200 dst=10.101.2.7 sport=443 dport=38684 src=10.101.2.7 dst=10.101.2.200 sport=38684 dport=443 [ASSURED]
    [NEW] tcp      6 120 SYN_SENT src=10.42.0.121 dst=10.101.2.7 sport=44571 dport=8080 [UNREPLIED] src=10.101.2.7 dst=10.42.0.121 sport=8080 dport=44571
 [UPDATE] tcp      6 120 FIN_WAIT src=10.101.2.200 dst=10.101.2.7 sport=443 dport=38684 src=10.101.2.7 dst=10.101.2.200 sport=38684 dport=443 [ASSURED]
 [UPDATE] tcp      6 60 SYN_RECV src=10.42.0.121 dst=10.101.2.7 sport=44571 dport=8080 src=10.101.2.7 dst=10.42.0.121 sport=8080 dport=44571
```

### Expected Behavior

Traffic routed through the Gateway API to an external IP specified in a custom `EndpointSlice` should successfully complete the TCP handshake and proxy the HTTP traffic, just as it does for internal pods.

## The work-around

The work-around is to use a pod that forwards all traffic instead of pointing
the `EndpointSlice` at the external IP directly.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: traffic-forward
spec:
  replicas: 1
  selector:
    matchLabels:
      app: traffic-forward
  template:
    metadata:
      labels:
        app: traffic-forward
    spec:
      containers:
        - name: socat
          image: alpine/socat:latest
          args: ["TCP-LISTEN:8080,fork,reuseaddr", "TCP:10.101.2.10:8080"]
          ports:
            - containerPort: 8080
              name: socat-port
          resources:
            limits:
              memory: 64Mi
            requests:
              memory: 64Mi
              cpu: 10m
---
apiVersion: v1
kind: Service
metadata:
  name: test
spec:
  ports:
    - protocol: TCP
      port: 8080
  selector:
    app: traffic-forward
```

A small socat container just proxies TCP traffic on to the real external address.
Since the Service now selects a normal in-cluster pod instead of a manual `EndpointSlice`,
Cilium and Envoy handle it exactly like any other backend, and the handshake completes normally.

## Maintainer feedback

I got a helpful response from Nick Young (@youngnick) on the issue:

> Gateway API is absolutely not intended to be used to forward to manual `EndpointSlices`,
> which is why this hasn't been tested and doesn't work. That's to prevent this CVE:
> [kubernetes/kubernetes#103675](https://github.com/kubernetes/kubernetes/issues/103675)
> in upstream Kubernetes.
> 
> In the longer term, there is a Backend Resource being developed upstream which
> will allow doing this by hostname explicitly (at the cost that you're accepting
> the security risk).

## Takeaway

If you're trying to bridge Kubernetes Gateway API traffic to a service running
outside the cluster, don't rely on a hand-written `EndpointSlice` pointing at an
external IP it's explicitly unsupported, and in Cilium's case it currently
breaks at the TCP handshake level rather than failing gracefully. A small
forwarding pod (`socat` or similar) is a safe, working alternative until a
first-class Backend resource for external hostnames lands upstream.
