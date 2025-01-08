import { useState, useEffect, useCallback, useMemo } from 'react'

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
  MessageCircle, 
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
  }, [marketId])

  // Fetch saved QA trees
  const fetchSavedTrees = useCallback(async () => {
    const fetchUrl = `/api/qa-trees?marketId=${marketId}`;
    console.group('Fetching QA Trees')
    console.log('Fetching trees for marketId:', marketId)
    console.log('Fetch URL:', fetchUrl)
    console.log('Starting fetch operation at:', new Date().toISOString())
    
    setIsLoading(true)
    try {
      console.log('DEBUG: Market ID =', marketId);
      console.log('DEBUG: Full fetch URL =', '/api/qa-trees?marketId=' + marketId);
      console.log('DEBUG: Options =', {credentials: 'include'});
      
      console.time('API Request Duration')
      const response = await fetch(`/api/qa-trees?marketId=${marketId}`, {
        credentials: 'include'
      })
      console.timeEnd('API Request Duration')

      console.group('Response Details')
      console.log('Status:', response.status)
      console.log('Status Text:', response.statusText)
      console.log('Headers:', Object.fromEntries([...response.headers]))
      
      const data = await response.json()
      console.log('Response Body:', data)
      console.groupEnd()

      if (!response.ok) {
        console.group('Request Failed')
        console.error('Error Details:', {
          status: response.status,
          statusText: response.statusText,
          error: data.error,
          timestamp: new Date().toISOString()
        })
        console.groupEnd()
        toast.error(data.error || 'Failed to fetch saved trees')
        console.groupEnd()
        return
      }

      console.group('Success Details')
      console.log(`Fetched ${data.length} trees`)
      console.log('First tree preview:', data[0] ? {
        id: data[0].tree_id,
        title: data[0].title,
        created: data[0].created_at
      } : 'No trees found')
      console.groupEnd()
      
      setSavedTrees(data)
    } catch (error) {
      console.group('Error Details')
      if (error instanceof Error) {
        console.error('Error Name:', error.name)
        console.error('Error Message:', error.message)
        console.error('Stack Trace:', error.stack)
        if (error instanceof TypeError) {
          console.error('Network Error Details:', {
            type: 'TypeError',
            likely_cause: 'Network or CORS issue'
          })
        }
      } else {
        console.error('Unknown Error Type:', error)
      }
      console.groupEnd()
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      console.error('Final Error Message:', errorMessage)
      toast.error('Failed to fetch saved trees')
    } finally {
      setIsLoading(false)
      console.log('Fetch operation completed at:', new Date().toISOString())
      console.groupEnd()
    }
  }, [marketId])

  // Load a specific saved tree
  const loadSavedTree = useCallback(async (treeId: string) => {
    console.log('Loading tree:', treeId);
    setIsLoading(true);
    try {
      const response = await fetch(`/api/qa-tree/${treeId}`, {
        credentials: 'include'
      });
      if (response.ok) {
        const tree = await response.json();
        console.log('Loaded tree:', tree);
        if (tree.tree_data) {
          // tree_data is already in QANode format
          setQAData([tree.tree_data]);
          setSelectedSavedTree(treeId);
          toast.success('Tree loaded successfully');
        } else {
          console.error('Invalid tree data:', tree);
          toast.error('Invalid tree data received');
        }
      } else {
        const error = await response.json();
        console.error('Failed to load tree:', error);
        toast.error(error.error || 'Failed to load tree');
      }
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

  // Node click handler
  const handleNodeClick = (nodeData: any) => {
    setSelectedNode(nodeData.data)
    setEditingNode(null)
  }

  // Edit node
  const startEditingNode = (node: TreeNode) => {
    setEditingNode(node)
    setSelectedNode(null)
  }

  // Update node question
  const updateNodeDetails = (newQuestion: string, existingAnswer: string) => {
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
          pathFunc={(linkData, orientation) => {
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
          renderCustomNodeElement={({ nodeDatum, toggleNode }) => (
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
                    updateNodeDetails(
                      questionInput.value,
                      editingNode.attributes.answer
                    )
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
                Are you sure you want to use "{newRootNode.name}" as the root for a new analysis tree?
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
      </div>
    </div>
  )
}

export default QATree
