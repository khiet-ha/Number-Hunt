# 06 — WebRTC and QR

## 1. MVP signaling

No signaling server.

Initial Host ↔ Player connection:

```text
Host creates offer
    |
    v
Offer QR
    |
Player scans
    |
creates answer
    |
    v
Answer QR
    |
Host scans
    |
WebRTC connection
```

## 2. QR envelope

Host offer:

```json
{
  "v": 1,
  "type": "room-offer",
  "roomId": "7F82KQ",
  "hostId": "p_host",
  "offer": "<SDP>",
  "timestamp": 1791240000
}
```

Player answer:

```json
{
  "v": 1,
  "type": "join-answer",
  "roomId": "7F82KQ",
  "hostId": "p_host",
  "playerId": "p_alice",
  "playerName": "Alice",
  "answer": "<SDP>",
  "timestamp": 1791240005
}
```

## 3. QR validation

Host validates:

- protocol version
- roomId
- hostId
- timestamp/expiry
- playerId
- player count
- player name length
- session token if implemented

Never accept an answer intended for another room.

## 4. ICE gathering

For QR bootstrap, use non-trickle ICE:

1. create offer
2. set local description
3. wait for ICE gathering to complete
4. encode complete SDP in QR

Same for answer.

This avoids requiring a second signaling channel for ICE candidates during the QR phase.

## 5. Full mesh bootstrap

Host initially connects to each player.

Once a new player joins, Host can relay signaling needed to create peer-to-peer connections between existing players and the new player:

```text
B -> Host -> C
C -> Host -> B
```

After B ↔ C is connected, normal data can travel directly.

## 6. Deterministic connection initiator

For a pair:

```text
lower joinSequence = initiator
higher joinSequence = responder
```

For renegotiation, use a perfect-negotiation style state machine rather than ad-hoc offer handling.

## 7. DataChannel

MVP:

```ts
pc.createDataChannel("game", {
  ordered: true
});
```

Use reliable ordered delivery for game/control messages.

## 8. Transport vs game protocol

WebRTC layer must not know:

- score
- currentTarget
- Host election
- winner

It only knows:

```text
send(message)
receive(message)
connection state
```

## 9. TURN

MVP can start without TURN because the target use case is nearby players.

Known limitation:

- some NAT/firewall combinations will fail direct P2P.

Do not redesign GameEngine because of this. Add TURN later if needed.

## 10. Connection states

Suggested handling:

```text
connected
    -> healthy

disconnected
    -> grace period

failed/closed
    -> unavailable
```

Do not trigger Host migration from a brief `disconnected` state alone.
