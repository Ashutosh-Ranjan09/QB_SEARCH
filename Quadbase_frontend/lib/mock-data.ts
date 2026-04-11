import type { Paper } from "@/components/result-card"

export const mockPapers: Paper[] = [
  {
    id: "2401.00001",
    title: "Attention Is All You Need: A Comprehensive Survey on Transformer Architectures",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar", "Jakob Uszkoreit"],
    categories: ["cs.CL", "cs.LG"],
    abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. The best performing models also connect the encoder and decoder through an attention mechanism. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable and requiring significantly less time to train."
  },
  {
    id: "2401.00002",
    title: "Deep Residual Learning for Image Recognition",
    authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"],
    categories: ["cs.CV", "cs.LG"],
    abstract: "Deeper neural networks are more difficult to train. We present a residual learning framework to ease the training of networks that are substantially deeper than those used previously. We explicitly reformulate the layers as learning residual functions with reference to the layer inputs, instead of learning unreferenced functions. We provide comprehensive empirical evidence showing that these residual networks are easier to optimize, and can gain accuracy from considerably increased depth."
  },
  {
    id: "2401.00003",
    title: "BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
    authors: ["Jacob Devlin", "Ming-Wei Chang", "Kenton Lee", "Kristina Toutanova"],
    categories: ["cs.CL", "cs.AI"],
    abstract: "We introduce a new language representation model called BERT, which stands for Bidirectional Encoder Representations from Transformers. Unlike recent language representation models, BERT is designed to pre-train deep bidirectional representations from unlabeled text by jointly conditioning on both left and right context in all layers. As a result, the pre-trained BERT model can be fine-tuned with just one additional output layer to create state-of-the-art models for a wide range of tasks."
  },
  {
    id: "2401.00004",
    title: "Generative Adversarial Networks: A Survey and Taxonomy",
    authors: ["Ian Goodfellow", "Jean Pouget-Abadie", "Mehdi Mirza", "Bing Xu"],
    categories: ["cs.LG", "cs.NE", "stat.ML"],
    abstract: "Generative adversarial networks (GANs) have achieved remarkable success in generating realistic images, videos, and audio. This survey provides a comprehensive overview of the GAN landscape, including fundamental concepts, architectural innovations, training techniques, and applications across various domains. We also discuss the theoretical foundations, challenges such as mode collapse and training instability, and future research directions in this rapidly evolving field."
  },
  {
    id: "2401.00005",
    title: "Neural Information Retrieval: A Literature Review",
    authors: ["Bhaskar Mitra", "Nick Craswell", "Emine Yilmaz"],
    categories: ["cs.IR", "cs.CL"],
    abstract: "Neural ranking models for information retrieval use deep neural networks to rank search results in response to a query. In this review, we provide an overview of neural ranking models including early semantic matching approaches, recent pre-trained language model approaches, and dense retrieval methods. We discuss the key challenges in applying deep learning to information retrieval tasks, evaluation methodologies, and promising research directions for neural IR systems."
  },
  {
    id: "2401.00006",
    title: "Reinforcement Learning: An Introduction to Policy Gradient Methods",
    authors: ["Richard S. Sutton", "Andrew G. Barto", "David Silver"],
    categories: ["cs.LG", "cs.AI"],
    abstract: "Reinforcement learning is learning what to do—how to map situations to actions—so as to maximize a numerical reward signal. This paper provides an introduction to policy gradient methods, a class of reinforcement learning algorithms that directly parameterize and optimize policies. We cover the theoretical foundations, practical algorithms including REINFORCE and actor-critic methods, and applications to continuous control and game playing."
  }
]

export const mockUploadedPapers: Paper[] = [
  {
    id: "UP-001",
    title: "Efficient Training of Large Language Models on Consumer Hardware",
    authors: ["Admin User", "Research Team"],
    categories: ["cs.LG", "cs.CL"],
    abstract: "This paper presents novel techniques for training large language models on consumer-grade hardware through a combination of gradient checkpointing, mixed precision training, and memory-efficient optimizers."
  },
  {
    id: "UP-002",
    title: "A Novel Approach to Semantic Search Using Hybrid Embeddings",
    authors: ["Admin User"],
    categories: ["cs.IR"],
    abstract: "We propose a hybrid embedding approach that combines dense and sparse representations for improved semantic search performance across multiple domains."
  }
]
