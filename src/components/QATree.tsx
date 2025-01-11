import { useState, useEffect, useCallback, useMemo } from 'react'
import { useUser } from '@auth0/nextjs-auth0/client'

function formatMarkdown(content: string) {
  if (typeof content !== 'string') {
    return '';
  }

  // Handle highlights
  content = content.replace(/\[\[HIGHLIGHT\]\](.*?)\[\[\/HIGHLIGHT\]\]/g, '<span class="highlight">$1</span>');

  // Handle unordered lists
  content = content.replace(/^\* (.*)$/gm, '<li>$1</li>');
  content = content.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');

  // Handle headings
  content = content.replace(/^# (.*$)/gm, '\n<h1 class="mb-8">\n$1</h1><hr>');
  content = content.replace(/^## (.*$)/gm, '\n<h2 class="mb-6">\n$1</h2><hr>');
  content = content.replace(/^### (.*$)/gm, '\n<h3 class="mb-4">\n$1</h3><hr>');
  content = content.replace(/^#### (.*$)/gm, '\n<h4 class="mb-2">\n$1</h4><hr>');
  content = content.replace(/^##### (.*$)/gm, '\n<h5 class="mb-1">\n$1</h5><hr>');
  content = content.replace(/^###### (.*$)/gm, '\n<h6 class="mb-1">\n$1</h6><hr>');

  // Handle bold and italics
  content = content.replace(/\*\*(.*?)\*\*/g, '\n<strong>$1</strong>');
  content = content.replace(/(\*|_)(.*?)\1/g, '\n<span>$2</span>');

  // Handle ordered lists
  content = content.replace(/(?:^\d+\. .*(?:\n(?!\d+\. |\n).*)*\n?)+/gm, function(match) {
    return '<ol>' + match.replace(/^\d+\. (.*(?:\n(?!\d+\. |\n).*)*)$/gm, '<li>$1</li>') + '</ol>';
  });

  // Wrap paragraphs, excluding headings, lists, and other HTML elements
  content = content.replace(/(?<!<h[1-6]>|<ul>|<\/ul>|<ol>|<\/ol>|<li>|<\/li>)(?!<ol>|<\/ol>|<li>|<\/li>)(.*?)(?=\n\n|$)/gs, '<p>$1</p>');

  // Remove empty paragraphs
  content = content.replace(/<p>\s*<\/p>/g, '');

  // Convert all remaining standalone newlines to <div> tags
  content = content.replace(/(?<!\n)\n(?!\n)/g, '<div class="line-break"></div>');

  return content;
}
import '@/styles/qa-tree.css'
import Tree from 'react-d3-tree'
import { 
  ZoomIn, 
  ZoomOut, 
  MousePointer, 
  GitBranch, 
  ListTree, 
  Save,
  Trash2,
  Edit,
  X,
  Check,
  Loader2  // Add this import
} from 'lucide-react'
import { toast } from 'sonner'

interface QANode {
  id?: string
  question: string
  answer: string
  children?: QANode[]
}

interface ExpansionModal {
  parentNode: TreeNode | null
  focus: string
  numLayers: number
  questionsPerLayer: number
}

interface GenerationModal {
  isOpen: boolean
  maxDepth: number
  nodesPerLayer: number
  isGenerating: boolean
}

interface TreeNode {
  name: string
  attributes: {
    answer: string
    id?: string
  }
  children?: TreeNode[]
}

interface SavedQATree {
  tree_id: string
  title: string
  description: string
  created_at: string
  market_id?: string
}

interface QATreeProps {
  marketId: string
  initialData?: QANode[]
}

const QATree: React.FC<QATreeProps> = ({ marketId, initialData }) => {
  const { user } = useUser()
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null)
  const [editingNode, setEditingNode] = useState<TreeNode | null>(null)
  const [newRootNode, setNewRootNode] = useState<TreeNode | null>(null)
  const [expansionModal, setExpansionModal] = useState<ExpansionModal>({
    parentNode: null,
    focus: '',
    numLayers: 2,
    questionsPerLayer: 2
  })
  
  // State for saved trees
  const [savedTrees, setSavedTrees] = useState<SavedQATree[]>([])
  const [selectedSavedTree, setSelectedSavedTree] = useState<string | null>(null)
  const [isSavedTreesOpen, setIsSavedTreesOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [generationModal, setGenerationModal] = useState<GenerationModal>({
    isOpen: false,
    maxDepth: 2,
    nodesPerLayer: 3,
    isGenerating: false
  })
  const [editingTreeTitle, setEditingTreeTitle] = useState<{
    treeId: string | null
    title: string
  }>({ treeId: null, title: '' })

  // Initial QA data with flexible initialization
  const [qaData, setQAData] = useState<QANode[]>(
    initialData || [
      {
        question: "What are the key factors that could influence this market?",
        answer: "Several economic and political factors could impact this market's outcome.",
        children: [
          {
            question: "How do economic indicators affect this?",
            answer: "Economic indicators like GDP, inflation, and employment rates can significantly influence market sentiment.",
            children: [
              {
                question: "Which economic indicator has the strongest correlation?",
                answer: "Historical data suggests GDP growth has the strongest correlation with this market's movements."
              }
            ]
          }
        ]
      }
    ]
  )

  // Transform QA data to tree-compatible format
  const transformData = useCallback((nodes: QANode[]): TreeNode[] => {
    const transformNode = (node: QANode): TreeNode => ({
      name: node.question,
      attributes: {
        answer: node.answer,
        id: node.id
      },
      children: node.children?.map(transformNode)
    })

    return nodes.map(transformNode)
  }, [])

  // Fetch saved QA trees
  const fetchSavedTrees = useCallback(async () => {
	  const fetchUrl = `/api/qa-trees?marketId=${marketId}`;
	  console.group('Fetching QA Trees');
	  console.log('Market ID:', marketId);
	  setIsLoading(true);
	  
	  try {
		// Get access token from Auth0
		let accessToken;
		try {
		  const response = await fetch('/api/auth/token');
		  if (!response.ok) {
			throw new Error('Failed to get access token');
		  }
		  const { token } = await response.json();
		  accessToken = token;
		  console.log('Successfully obtained access token');
		} catch (tokenError) {
		  console.error('Error getting access token:', tokenError);
		  toast.error('Authentication error. Please try again.');
		  return;
		}
		
		const response = await fetch(fetchUrl, {
		  credentials: 'include',
		  headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${accessToken}`,
			'X-Request-ID': Math.random().toString(36).substring(7),
			'X-Client-Version': '1.0.0'
		  }
		});
		
		console.log('Response:', { 
		  status: response.status, 
		  ok: response.ok,
		  headers: Object.fromEntries(response.headers.entries())
		});
		
		if (response.status === 401) {
		  console.error('Unauthorized - invalid or expired token', {
			user: user?.sub,
			tokenPresent: !!accessToken
		  });
		  toast.error('Session expired. Please refresh the page.');
		  return;
		}
		
		if (!response.ok) {
		  const errorText = await response.text();
		  throw new Error(`HTTP error ${response.status}: ${errorText}`);
		}
		
		const data = await response.json();
		console.log(`Fetched ${data.length} trees for market ${marketId}`, {
		  firstTree: data[0]?.tree_id,
		  timestamp: new Date().toISOString()
		});
		setSavedTrees(data);
	  } catch (error) {
		console.error('Error fetching QA trees:', {
		  error: {
			message: error.message,
			stack: error.stack,
			name: error.name
		  },
		  context: {
			marketId,
			userId: user?.sub,
			timestamp: new Date().toISOString()
		  }
		});
		toast.error('Failed to load QA trees');
	  } finally {
		setIsLoading(false);
		console.groupEnd();
	  }
	}, [marketId, user?.sub])

  // Load a specific saved tree
  // Load a specific saved tree
	const loadSavedTree = useCallback(async (treeId: string) => {
	  console.log('Loading tree:', treeId);
	  setIsLoading(true);
	  try {
		const response = await fetch(`/api/qa-trees/${treeId}`, {
		  credentials: 'include'
		});

		if (!response.ok) {
		  const error = await response.json();
		  console.error('Failed to load tree:', error);
		  toast.error(error.error || 'Failed to load tree');
		  return;
		}
		
		const treeData = await response.json();
		console.log('Loaded tree data:', treeData);

		// Directly set the tree data if it matches QANode structure
		setQAData([treeData]);
		setSelectedSavedTree(treeId);
		toast.success('Tree loaded successfully');
	  } catch (error) {
		console.error('Error loading tree:', error);
		toast.error('Failed to load tree');
	  } finally {
		setIsLoading(false);
	  }
	}, []);

  // Save current tree
  const saveCurrentTree = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/save-qa-tree', {
        method: 'POST',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          marketId,
          treeData: qaData
        })
      })

      if (response.ok) {
        await fetchSavedTrees()
        toast.success('Tree saved successfully')
      }
    } catch (error) {
      console.error('Error saving QA tree:', error)
      toast.error('Failed to save tree')
    } finally {
      setIsLoading(false)
    }
  }

  // Delete a saved tree
  const deleteSavedTree = async (treeId: string) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/qa-tree/${treeId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json'
        }
      })

      if (response.ok) {
        await fetchSavedTrees()
        toast.success('Tree deleted successfully')
      }
    } catch (error) {
      console.error('Error deleting QA tree:', error)
      toast.error('Failed to delete tree')
    } finally {
      setIsLoading(false)
    }
  }

  // Edit a saved tree's title
  const handleGenerateTree = async () => {
    setGenerationModal(prev => ({ ...prev, isGenerating: true }));
    try {
      // Get access token
      const tokenResponse = await fetch('/api/auth/token');
      if (!tokenResponse.ok) {
        throw new Error('Failed to get access token');
      }
      const { token } = await tokenResponse.json();

      // Call generate endpoint
      const response = await fetch('/api/qa-trees/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          marketId,
          maxDepth: generationModal.maxDepth,
          nodesPerLayer: generationModal.nodesPerLayer
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate tree');
      }

      const { treeId } = await response.json();
      
      // Load the newly generated tree
      await loadSavedTree(treeId);
      
      // Close modal and show success
      setGenerationModal(prev => ({ ...prev, isOpen: false }));
      toast.success('Tree generated successfully');
      
      // Refresh saved trees list
      await fetchSavedTrees();
      
    } catch (error) {
      console.error('Error generating tree:', error);
      toast.error(error.message || 'Failed to generate tree');
    } finally {
      setGenerationModal(prev => ({ ...prev, isGenerating: false }));
    }
  };

  const updateTreeTitle = async () => {
    if (!editingTreeTitle.treeId) return
    
    setIsLoading(true)
    try {
      const response = await fetch(`/api/update-qa-tree-title/${editingTreeTitle.treeId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title: editingTreeTitle.title
        })
      })

      if (response.ok) {
        await fetchSavedTrees()
        toast.success('Tree title updated')
        setEditingTreeTitle({ treeId: null, title: '' })
      }
    } catch (error) {
      console.error('Error updating tree title:', error)
      toast.error('Failed to update tree title')
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch saved trees on component mount
  useEffect(() => {
    fetchSavedTrees()
  }, [fetchSavedTrees])

  // Prepare tree data for rendering
  const treeData = useMemo(() => transformData(qaData), [qaData, transformData])

  interface NodeData {
    data: TreeNode
  }

  // Node click handler
  const handleNodeClick = (nodeData: NodeData) => {
    setSelectedNode(nodeData.data)
    setEditingNode(null)
  }

  // Edit node
  const startEditingNode = (node: TreeNode) => {
    setEditingNode(node)
    setSelectedNode(null)
  }

  // Update node question
  const updateNodeDetails = (newQuestion: string) => {
    if (!editingNode) return

    const updateNode = (node: QANode): QANode => {
      if (node.question === editingNode.name) {
        return { ...node, question: newQuestion }
      }
      return node
    }

    setQAData(prevData => 
      prevData.map(updateNode).map(node => ({
        ...node,
        children: node.children?.map(updateNode)
      }))
    )

    setEditingNode(null)
  }

  return (
    <div className="mt-4 relative">
      <div className="border-t border-white/10 mb-4 pt-4 flex justify-end gap-2">
        <button
          onClick={() => setZoom(z => z + 0.2)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom(z => z - 0.2)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          onClick={() => setZoom(1)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <MousePointer className="w-4 h-4" />
        </button>
        <button
          onClick={() => setIsSavedTreesOpen(!isSavedTreesOpen)}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
          title="Saved Trees"
        >
          <ListTree className="w-4 h-4" />
        </button>
        <button
          onClick={saveCurrentTree}
          disabled={isLoading}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
          title="Save Tree"
        >
          <Save className="w-4 h-4" />
        </button>
        <button
          onClick={() => setGenerationModal(prev => ({ ...prev, isOpen: true }))}
          disabled={isLoading || !user}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
          title="Generate New Tree"
        >
          <GitBranch className="w-4 h-4" />
        </button>
      </div>

      {/* Tree Visualization */}
      <div className="relative" style={{ height: '600px' }}>
        <Tree
          data={treeData[0]}
          orientation="vertical"
          translate={translate}
          zoom={zoom}
          onNodeClick={handleNodeClick}
          rootNodeClassName="node__root"
          branchNodeClassName="node__branch"
          leafNodeClassName="node__leaf"
          pathClassFunc={() => 'node__link rd3t-link'}
          pathFunc={(linkData) => {
            const { source, target } = linkData;
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            return `M${source.x},${source.y}
                    L${midX},${midY}
                    L${target.x},${target.y}`;
          }}
          renderCustomPathMarker={() => (
            <marker
              id="arrowhead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="white" />
            </marker>
          )}
          separation={{ siblings: 2.5, nonSiblings: 3 }}
          nodeSize={{ x: 500, y: 400 }}
          zoomable={true}
          scaleExtent={{ min: 0.1, max: 20 }}
          renderCustomPathLabel={({ source, target }) => {
            const midX = (source.x + target.x) / 2;
            const midY = (source.y + target.y) / 2;
            return (
              <text
                x={midX}
                y={midY}
                className="rd3t-link-text"
                dy="-10"
              >
                leads to
              </text>
            );
          }}
          renderCustomNodeElement={({ nodeDatum }) => (
            <g>
              <foreignObject width={400} height={200} x={-200} y={-100} className="qa-tree-node">
                <div className="bg-gray-800/90 rounded-lg shadow-lg border border-white/10 qa-tree-node-content">
                  <div className="px-6 py-4">
                    <div className="flex justify-between items-start gap-2 mb-2">
                      <div 
                        className="font-medium text-sm"
                        dangerouslySetInnerHTML={{
                          __html: formatMarkdown(nodeDatum.name)
                        }}
                      />
                      <div className="flex space-x-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditingNode(nodeDatum);
                          }}
                          className="p-1 hover:bg-white/10 rounded"
                        >
                          <Edit className="w-4 h-4 text-gray-400" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setNewRootNode(nodeDatum);
                          }}
                          className="p-1 hover:bg-white/10 rounded"
                        >
                          <GitBranch className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </div>
                    <div className="border-t-2 border-white/40 my-2" />
                    <div 
                      className="text-xs text-gray-400 whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{
                        __html: formatMarkdown(nodeDatum.attributes?.answer)
                      }}
                    />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpansionModal({
                        parentNode: nodeDatum,
                        focus: '',
                        numLayers: 2,
                        questionsPerLayer: 2
                      });
                    }}
                    className="absolute bottom-2 right-2 w-6 h-6 hover:bg-white/10 rounded-full flex items-center justify-center bg-gray-800/90"
                  >
                    <span className="text-white text-lg leading-none">+</span>
                  </button>
                </div>
              </foreignObject>
            </g>
          )}
        />
        
        {/* Selected Node Details */}
        {selectedNode && (
          <div className="absolute bottom-4 left-4 right-4 bg-gray-800/95 p-4 rounded-lg border border-white/10 shadow-xl">
            <h5 className="font-bold mb-2">{selectedNode.name}</h5>
            <p className="text-sm text-gray-300">{selectedNode.attributes.answer}</p>
          </div>
        )}

        {/* Node Editing Modal */}
        {editingNode && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                Edit Node
              </h3>
              <input
                type="text"
                defaultValue={editingNode.name}
                placeholder="Question"
                className="w-full p-2 mb-4 bg-gray-700 rounded"
                ref={el => el && el.focus()}
              />
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setEditingNode(null)}
                  className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => {
                    const questionInput = e.currentTarget.parentElement?.previousElementSibling as HTMLInputElement
                    updateNodeDetails(questionInput.value)
                  }}
                  className="px-4 py-2 bg-blue-500 rounded hover:bg-blue-600"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

{/* Saved Trees Sidebar */}
        {isSavedTreesOpen && (
          <div className="absolute top-0 right-0 w-64 h-full bg-gray-800/95 p-4 z-50 overflow-y-auto shadow-xl border-l border-white/10">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">
                Saved Trees
              </h3>
              <button 
                onClick={() => setIsSavedTreesOpen(false)}
                className="p-1 hover:bg-white/10 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isLoading ? (
              <div className="flex justify-center items-center h-full">
                <div className="animate-spin">
                  <Loader2 className="w-8 h-8 text-gray-400" />
                </div>
              </div>
            ) : savedTrees.length === 0 ? (
              <p className="text-gray-400 text-center">No saved trees</p>
            ) : (
              <div className="space-y-2">
                {savedTrees.map(tree => (
                  <div 
                    key={tree.tree_id} 
                    className={`
                      p-3 rounded-lg cursor-pointer 
                      transition-colors duration-200
                      ${selectedSavedTree === tree.tree_id 
                        ? 'bg-blue-500/20' 
                        : 'hover:bg-white/10'
                      } relative
                    `}
                  >
                    {editingTreeTitle.treeId === tree.tree_id ? (
                      <div className="flex items-center space-x-2">
                        <input
                          type="text"
                          value={editingTreeTitle.title}
                          onChange={(e) => setEditingTreeTitle(prev => ({
                            ...prev,
                            title: e.target.value
                          }))}
                          className="flex-grow p-1 bg-gray-700 rounded"
                        />
                        <button 
                          onClick={updateTreeTitle}
                          className="text-green-500 hover:bg-white/10 p-1 rounded"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                        <button 
                          onClick={() => setEditingTreeTitle({ treeId: null, title: '' })}
                          className="text-red-500 hover:bg-white/10 p-1 rounded"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <div 
                        onClick={() => {
                          console.log('Loading tree with ID:', tree.tree_id);
                          loadSavedTree(tree.tree_id);
                        }}
                        className="flex justify-between items-center"
                      >
                        <div>
                          <p className="font-medium">
                            {tree.title || `Tree for ${tree.market_id || 'Unknown Market'}`}
                          </p>
                          <p className="text-xs text-gray-400">
                            {new Date(tree.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <div className="flex space-x-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditingTreeTitle({
                                treeId: tree.tree_id,
                                title: tree.title || ''
                              })
                            }}
                            className="text-gray-400 hover:text-white p-1 rounded hover:bg-white/10"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteSavedTree(tree.tree_id)
                            }}
                            className="text-red-500 hover:bg-white/10 p-1 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* New Root Node Confirmation */}
        {newRootNode && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                Create New Tree
              </h3>
              <p className="text-sm text-gray-300 mb-6">
                Are you sure you want to use &quot;{newRootNode.name}&quot; as the root for a new analysis tree?
              </p>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => setNewRootNode(null)}
                  className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // TODO: Implement new tree creation logic
                    // This would involve creating a new tree with the selected node as root
                    console.log('Creating new tree with root:', newRootNode)
                    setNewRootNode(null)
                  }}
                  className="px-4 py-2 bg-blue-500 rounded hover:bg-blue-600"
                >
                  Create Tree
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Node Expansion Modal */}
        {expansionModal.parentNode && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                Expand Node
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Focus Area</label>
                  <input
                    type="text"
                    value={expansionModal.focus}
                    onChange={(e) => setExpansionModal(prev => ({
                      ...prev,
                      focus: e.target.value
                    }))}
                    placeholder="Enter focus area for new nodes (leave blank for default)"
                    className="w-full p-2 bg-gray-700 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Number of Layers</label>
                  <input
                    type="number"
                    min="1"
                    max="3"
                    value={expansionModal.numLayers}
                    onChange={(e) => setExpansionModal(prev => ({
                      ...prev,
                      numLayers: parseInt(e.target.value)
                    }))}
                    className="w-full p-2 bg-gray-700 rounded"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Questions per Layer</label>
                  <input
                    type="number"
                    min="1"
                    max="4"
                    value={expansionModal.questionsPerLayer}
                    onChange={(e) => setExpansionModal(prev => ({
                      ...prev,
                      questionsPerLayer: parseInt(e.target.value)
                    }))}
                    className="w-full p-2 bg-gray-700 rounded"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  onClick={() => setExpansionModal({
                    parentNode: null,
                    focus: '',
                    numLayers: 2,
                    questionsPerLayer: 2
                  })}
                  className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-500"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    // Generate placeholder nodes based on user specifications
                    const generatePlaceholderNodes = (depth: number, nodesPerLayer: number): QANode[] => {
                      if (depth <= 0) return [];
                      
                      return Array(nodesPerLayer).fill(null).map((_, i) => ({
                        question: `Placeholder Question ${i + 1} (Layer ${expansionModal.numLayers - depth + 1})`,
                        answer: `This is a placeholder answer that will be replaced with AI-generated content. Focus: ${expansionModal.focus || 'General'}`,
                        children: generatePlaceholderNodes(depth - 1, nodesPerLayer)
                      }));
                    };

                    // Update the tree data by finding and modifying the target node
                    const updateTreeData = (nodes: QANode[]): QANode[] => {
                      return nodes.map(node => {
                        if (node.question === expansionModal.parentNode?.name) {
                          return {
                            ...node,
                            children: [
                              ...(node.children || []),
                              ...generatePlaceholderNodes(
                                expansionModal.numLayers,
                                expansionModal.questionsPerLayer
                              )
                            ]
                          };
                        }
                        if (node.children) {
                          return {
                            ...node,
                            children: updateTreeData(node.children)
                          };
                        }
                        return node;
                      });
                    };

                    // Store current position and zoom
                    const currentTranslate = translate;
                    const currentZoom = zoom;
                    
                    // Update tree data
                    setQAData(prevData => updateTreeData(prevData));
                    
                    // Reset modal state
                    setExpansionModal({
                      parentNode: null,
                      focus: '',
                      numLayers: 2,
                      questionsPerLayer: 2
                    });

                    // Restore position and zoom in the next render cycle
                    requestAnimationFrame(() => {
                      setTranslate(currentTranslate);
                      setZoom(currentZoom);
                    });
                  }}
                  className="px-4 py-2 bg-blue-500 rounded hover:bg-blue-600"
                >
                  Generate
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Generation Modal */}
        {generationModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
              <h3 className="text-lg font-bold mb-4">
                Generate QA Tree
              </h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Maximum Depth</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={generationModal.maxDepth}
                    onChange={(e) => setGenerationModal(prev => ({
                      ...prev,
                      maxDepth: Math.min(5, Math.max(1, parseInt(e.target.value) || 1))
                    }))}
                    disabled={generationModal.isGenerating}
                    className="w-full p-2 bg-gray-700 rounded disabled:opacity-50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Nodes per Layer</label>
                  <input
                    type="number"
                    min="1"
                    max="5"
                    value={generationModal.nodesPerLayer}
                    onChange={(e) => setGenerationModal(prev => ({
                      ...prev,
                      nodesPerLayer: Math.min(5, Math.max(1, parseInt(e.target.value) || 1))
                    }))}
                    disabled={generationModal.isGenerating}
                    className="w-full p-2 bg-gray-700 rounded disabled:opacity-50"
                  />
                </div>
              </div>
              <div className="flex justify-end space-x-2 mt-6">
                <button
                  onClick={() => setGenerationModal(prev => ({ ...prev, isOpen: false }))}
                  disabled={generationModal.isGenerating}
                  className="px-4 py-2 bg-gray-600 rounded hover:bg-gray-500 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateTree}
                  disabled={generationModal.isGenerating}
                  className="px-4 py-2 bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50 flex items-center gap-2"
                >
                  {generationModal.isGenerating && (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  )}
                  {generationModal.isGenerating ? 'Generating...' : 'Generate'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default QATree
