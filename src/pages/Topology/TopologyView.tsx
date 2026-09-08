import React, { useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  Panel,
  useNodesState,
  useEdgesState,
  Node,
  Edge,
  ConnectionLineType,
  Handle,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import { makeStyles, tokens, Title1, Text, Badge } from '@fluentui/react-components';
import { useProjectStore } from '../../store/useProjectStore';
import { WorkspaceTasks } from './WorkspaceTasks';
import { SecurityPanel } from './SecurityPanel';
import { commands } from '../../bindings';
import { formatBytes } from '../../utils/formatters';

const useStyles = makeStyles({
  layout: {
    display: 'flex',
    height: '100%',
    width: '100%',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  flowContainer: {
    flex: 1,
    height: '100%',
    position: 'relative',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '16px',
    color: tokens.colorNeutralForeground3,
  },
  node: {
    padding: '10px 20px',
    borderRadius: '8px',
    backgroundColor: tokens.colorBrandBackground2,
    border: `1px solid ${tokens.colorBrandStroke1}`,
    color: tokens.colorNeutralForeground1,
    fontWeight: 'bold',
    minWidth: '150px',
    textAlign: 'center',
    boxShadow: tokens.shadow4,
  },
});

const nodeWidth = 172;
const nodeHeight = 42;

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const newNode = {
      ...node,
      targetPosition: 'top' as any,
      sourcePosition: 'bottom' as any,
      position: {
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - nodeHeight / 2,
      },
    };
    return newNode;
  });

  return { nodes: newNodes, edges };
};

const PackageNode = ({ data }: { data: any }) => {
  const styles = useStyles();
  return (
    <div className={styles.node}>
      <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span>{data.label}</span>
        {data.size && (
          <Badge appearance="tint" color="brand">
            {data.size}
          </Badge>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
  );
};

const nodeTypes = {
  package: PackageNode,
};

export const TopologyView: React.FC = () => {
  const styles = useStyles();
  const { selectedProject } = useProjectStore();

  const { initialNodes, initialEdges, hasCycle } = useMemo(() => {
    if (!selectedProject) return { initialNodes: [], initialEdges: [], hasCycle: false };

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const pkgNames = new Set(selectedProject.packages.map((p) => p.name));

    selectedProject.packages.forEach((pkg) => {
      nodes.push({
        id: pkg.name,
        type: 'package',
        position: { x: 0, y: 0 },
        data: { label: pkg.name },
      });

      // Map dependencies to edges
      pkg.dependencies.forEach((dep) => {
        // Only draw edges to other packages in the workspace
        if (pkgNames.has(dep.name)) {
          edges.push({
            id: `e-${pkg.name}-${dep.name}`,
            source: pkg.name,
            target: dep.name,
            type: 'smoothstep',
            animated: true,
          });
        }
      });
      // devDependencies
      pkg.dev_dependencies.forEach((dep) => {
        if (pkgNames.has(dep.name)) {
          edges.push({
            id: `e-dev-${pkg.name}-${dep.name}`,
            source: pkg.name,
            target: dep.name,
            type: 'smoothstep',
            animated: true,
            style: { strokeDasharray: '5 5' },
          });
        }
      });
    });

    const adj = new Map<string, string[]>();
    edges.forEach(e => {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    });

    const ids = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    let idCounter = 0;
    const sccs: Set<string>[] = [];

    function dfs(u: string) {
      stack.push(u);
      onStack.add(u);
      ids.set(u, idCounter);
      low.set(u, idCounter);
      idCounter++;

      for (const v of adj.get(u) || []) {
        if (!ids.has(v)) {
          dfs(v);
          low.set(u, Math.min(low.get(u)!, low.get(v)!));
        } else if (onStack.has(v)) {
          low.set(u, Math.min(low.get(u)!, ids.get(v)!));
        }
      }

      if (ids.get(u) === low.get(u)) {
        const scc = new Set<string>();
        let v;
        do {
          v = stack.pop()!;
          onStack.delete(v);
          scc.add(v);
        } while (v !== u);
        if (scc.size > 1 || (adj.get(u) || []).includes(u)) {
          sccs.push(scc);
        }
      }
    }

    const allNodes = new Set<string>();
    edges.forEach(e => {
      allNodes.add(e.source);
      allNodes.add(e.target);
    });

    for (const u of allNodes) {
      if (!ids.has(u)) {
        dfs(u);
      }
    }

    const cyclicEdgeIds = new Set<string>();
    edges.forEach(e => {
      for (const scc of sccs) {
        if (scc.has(e.source) && scc.has(e.target)) {
          cyclicEdgeIds.add(e.id);
          break;
        }
      }
    });

    const finalEdges = edges.map(e => {
      if (cyclicEdgeIds.has(e.id)) {
        return {
          ...e,
          animated: true,
          style: { ...(e.style || {}), stroke: '#ff4d4f', strokeWidth: 2 },
        };
      }
      return e;
    });

    const layout = getLayoutedElements(nodes, finalEdges);
    return { 
      initialNodes: layout.nodes, 
      initialEdges: layout.edges,
      hasCycle: cyclicEdgeIds.size > 0
    };
  }, [selectedProject]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  React.useEffect(() => {
    if (!selectedProject) return;
    let mounted = true;

    const fetchSizes = async () => {
      const newSizes: Record<string, string> = {};
      const paths = selectedProject.packages.map((pkg) => pkg.path);
      try {
        const res = await commands.getDirectorySizes(paths);
        if (res.status === 'ok' && res.data) {
          for (const pkg of selectedProject.packages) {
            const bytes = res.data[pkg.path];
            newSizes[pkg.name] = bytes != null ? formatBytes(bytes) : '0 B';
          }
        } else {
          for (const pkg of selectedProject.packages) {
            newSizes[pkg.name] = 'Error';
          }
        }
      } catch {
        for (const pkg of selectedProject.packages) {
          newSizes[pkg.name] = 'Error';
        }
      }
      if (mounted) {
        setNodes((nds) => 
          nds.map((node) => ({
            ...node,
            data: { ...node.data, size: newSizes[node.id] }
          }))
        );
      }
    };

    fetchSizes();
    return () => { mounted = false; };
  }, [selectedProject, setNodes]);

  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  if (!selectedProject) {
    return (
      <div className={styles.layout}>
        <div className={styles.emptyState}>
          <Title1>No Project Selected</Title1>
          <Text>Please select a project from the Dashboard or Projects view to see its topology.</Text>
        </div>
      </div>
    );
  }



  return (
    <div className={styles.layout}>
      <div className={styles.flowContainer}>
        {hasCycle && (
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 10, background: '#ff4d4f', color: '#fff', padding: '8px 16px', borderRadius: 4, fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
            Cyclic Dependency Detected!
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          connectionLineType={ConnectionLineType.SmoothStep}
          fitView
        >
          <Background color={tokens.colorNeutralStroke1} />
          <Controls />
          <Panel position="top-left">
            <Title1>{selectedProject.name} Topology</Title1>
          </Panel>
        </ReactFlow>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <WorkspaceTasks />
        <SecurityPanel />
      </div>
    </div>
  );
};
