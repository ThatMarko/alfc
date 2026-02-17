# ALFC Compatibility Matrix

## Protocol Version: 1.0

### Client Compatibility

| Client                     | Min Protocol | Max Protocol | Status       | Notes                             |
| -------------------------- | ------------ | ------------ | ------------ | --------------------------------- |
| React Web UI               | 1.0          | 1.x          | Stable       | Ships with server, always matches |
| KDE Plasma 6 Plasmoid v2.x | 1.0          | 1.x          | Experimental | Separate install, may lag behind  |

### Protocol Evolution Rules

1. **Minor bumps (1.0 → 1.1)**: Additive only
   - New message kinds: old clients ignore them
   - New optional fields in State: old clients ignore them
   - New optional fields in responses: old clients ignore them

2. **Major bumps (1.x → 2.0)**: Breaking changes
   - Requires deprecation period where both versions accepted
   - Clients must check `protocolVersion` in initial state push
   - Timeline: minimum 1 release cycle overlap

### State Shape Additions Log

| Field                   | Added In | Required | Default     | Notes              |
| ----------------------- | -------- | -------- | ----------- | ------------------ |
| `protocolVersion`       | 1.0      | Yes      | `"1.0"`     | Always present     |
| `isCpuTuningAvailable`  | 1.0      | No       | `undefined` | Platform-dependent |
| `isFanControlAvailable` | 1.0      | No       | `undefined` | Platform-dependent |
| `isGpuBoostAvailable`   | 1.0      | No       | `undefined` | Platform-dependent |

### Release Gates

#### Experimental (current)

- [ ] All `bun run all-checks` pass
- [ ] Plasmoid installs via `kpackagetool6`
- [ ] Plasmoid connects and renders state
- [ ] Plasmoid recovers from backend restart
- [ ] Manual smoke test on at least 1 distro

#### Stable (future)

- [ ] All Experimental gates met
- [ ] Soak test: 2h+ session with periodic toggles, no stuck state
- [ ] Dual-client test: React + Plasmoid simultaneously, no conflicts
- [ ] Performance: idle CPU/memory within budget
- [ ] At least 2 distros tested (e.g. Arch + Fedora)
- [ ] No known critical bugs

### Breaking Change Checklist

Before ANY protocol-breaking change:

1. Update `protocolVersion` in server
2. Update `PROTOCOL.md` with new version section
3. Update this compatibility matrix
4. Ensure old client version still works (deprecation period)
5. Tag release with protocol version in notes
