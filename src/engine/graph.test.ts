import { describe, it, expect } from 'vitest';
import { GRAPH, NODES, CONSUMERS } from './graph';

describe('graph (SDD §5)', () => {
  it('has 27 nodes', () => expect(GRAPH.length).toBe(27));

  it('NODES indexes every node by name', () => {
    expect(Object.keys(NODES).length).toBe(27);
    expect(NODES['catalyst']!.black).toBe(true);
    expect(NODES['water']!.crit).toBe(1.0);
  });

  it('invariant: black nodes have no inputs (no derived demand)', () => {
    for (const n of GRAPH) if (n.black) expect(n.inputs.length).toBe(0);
  });

  it('every input references an existing node (DAG well-formed)', () => {
    for (const n of GRAPH) for (const [inp] of n.inputs) expect(NODES[inp]).toBeDefined();
  });

  it('CONSUMERS reverses the BOM edges', () => {
    // catalyst feeds methane_fuel, ammonia, base_polymer, fertilizer, epoxy
    const cat = CONSUMERS['catalyst']!.map(([name]) => name).sort();
    expect(cat).toEqual(['ammonia', 'base_polymer', 'epoxy', 'fertilizer', 'methane_fuel']);
    // regolith with quantities
    const reg = Object.fromEntries(CONSUMERS['regolith']!);
    expect(reg['steel']).toBe(0.6);
    expect(reg['ceramics']).toBe(0.2);
  });

  it('graph is acyclic (inputs resolvable in topological order)', () => {
    const resolved = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const n of GRAPH) {
        if (resolved.has(n.name)) continue;
        if (n.inputs.every(([inp]) => resolved.has(inp))) {
          resolved.add(n.name);
          changed = true;
        }
      }
    }
    expect(resolved.size).toBe(GRAPH.length);
  });
});
