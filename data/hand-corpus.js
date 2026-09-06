/* 손으로 만든 코퍼스 (논문 78 · 모델 8 · 아티클 3 · 인용 266 · describes 8).
   safari.html 과 graph.html 이 인라인으로 갖고 있던 것을 한 곳으로 옮겼다.
   backtest/data.mjs 가 이 파일의 const PAPERS / MODELS / ARTICLES / CITE_SRC 를 파싱한다. 이름·형식을 바꾸지 마라.
   화면 페이지들은 이 파일이 아니라 assets/corpus.js(빌드 산출물)를 읽는다. 생성: node tools/build-corpus.mjs */

// [id, 제목, 연도, arXiv id, 대략 피인용수, 토픽]
const PAPERS = [
  ["lstm","Long Short-Term Memory",1997,"","110000","arch"],
  ["seq2seq","Sequence to Sequence Learning with Neural Networks",2014,"1409.3215","28000","arch"],
  ["bahdanau","Neural Machine Translation by Jointly Learning to Align and Translate",2014,"1409.0473","38000","arch"],
  ["adam","Adam: A Method for Stochastic Optimization",2014,"1412.6980","190000","opt"],
  ["resnet","Deep Residual Learning for Image Recognition",2015,"1512.03385","240000","vis"],
  ["layernorm","Layer Normalization",2016,"1607.06450","12000","arch"],
  ["moe","Outrageously Large Neural Networks: The Sparsely-Gated MoE Layer",2017,"1701.06538","3100","moe"],
  ["attention","Attention Is All You Need",2017,"1706.03762","135000","arch"],
  ["ppo","Proximal Policy Optimization Algorithms",2017,"1707.06347","23000","align"],
  ["gpipe","GPipe: Efficient Training of Giant Neural Networks",2018,"1811.06965","1600","sys"],
  ["bert","BERT: Pre-training of Deep Bidirectional Transformers",2018,"1810.04805","115000","arch"],
  ["gpt2","Language Models are Unsupervised Multitask Learners",2019,"","14000","arch"],
  ["megatron","Megatron-LM: Training Multi-Billion Parameter LMs",2019,"1909.08053","2600","sys"],
  ["zero","ZeRO: Memory Optimizations Toward Training Trillion Parameter Models",2019,"1910.02054","1800","sys"],
  ["t5","Exploring the Limits of Transfer Learning (T5)",2019,"1910.10683","19000","arch"],
  ["mqa","Fast Transformer Decoding: One Write-Head is All You Need",2019,"1911.02150","520","eff"],
  ["scaling","Scaling Laws for Neural Language Models",2020,"2001.08361","3400","scale"],
  ["dpr","Dense Passage Retrieval for Open-Domain QA",2020,"2004.04906","4200","rag"],
  ["colbert","ColBERT: Efficient Passage Search over BERT",2020,"2004.12832","1600","rag"],
  ["rag","Retrieval-Augmented Generation for Knowledge-Intensive NLP",2020,"2005.11401","5600","rag"],
  ["gpt3","Language Models are Few-Shot Learners",2020,"2005.14165","38000","arch"],
  ["ddpm","Denoising Diffusion Probabilistic Models",2020,"2006.11239","16000","vis"],
  ["gshard","GShard: Scaling Giant Models with Conditional Computation",2020,"2006.16668","1100","moe"],
  ["rlhfsum","Learning to Summarize from Human Feedback",2020,"2009.01325","3100","align"],
  ["mmlu","Measuring Massive Multitask Language Understanding",2020,"2009.03300","4300","eval"],
  ["vit","An Image is Worth 16x16 Words (ViT)",2020,"2010.11929","44000","vis"],
  ["switch","Switch Transformers: Scaling to Trillion Parameter Models",2021,"2101.03961","2200","moe"],
  ["clip","Learning Transferable Visual Models from Natural Language",2021,"2103.00020","28000","vis"],
  ["rope","RoFormer: Enhanced Transformer with Rotary Position Embedding",2021,"2104.09864","2600","arch"],
  ["lora","LoRA: Low-Rank Adaptation of Large Language Models",2021,"2106.09685","9800","eff"],
  ["humaneval","Evaluating Large Language Models Trained on Code",2021,"2107.03374","6100","eval"],
  ["alibi","Train Short, Test Long: Attention with Linear Biases",2021,"2108.12409","1100","arch"],
  ["gsm8k","Training Verifiers to Solve Math Word Problems",2021,"2110.14168","2900","eval"],
  ["s4","Efficiently Modeling Long Sequences with Structured State Spaces",2021,"2111.00396","1900","ssm"],
  ["ldm","High-Resolution Image Synthesis with Latent Diffusion Models",2021,"2112.10752","19000","vis"],
  ["cot","Chain-of-Thought Prompting Elicits Reasoning in LLMs",2022,"2201.11903","10000","reason"],
  ["instructgpt","Training Language Models to Follow Instructions with Human Feedback",2022,"2203.02155","11000","align"],
  ["selfcons","Self-Consistency Improves Chain of Thought Reasoning",2022,"2203.11171","3200","reason"],
  ["chinchilla","Training Compute-Optimal Large Language Models",2022,"2203.15556","3500","scale"],
  ["flash","FlashAttention: Fast and Memory-Efficient Exact Attention",2022,"2205.14135","2900","eff"],
  ["bigbench","Beyond the Imitation Game (BIG-bench)",2022,"2206.04615","1500","eval"],
  ["expertchoice","Mixture-of-Experts with Expert Choice Routing",2022,"2202.09368","420","moe"],
  ["react","ReAct: Synergizing Reasoning and Acting in Language Models",2022,"2210.03629","3600","reason"],
  ["specdec","Fast Inference from Transformers via Speculative Decoding",2022,"2211.17192","830","eff"],
  ["whisper","Robust Speech Recognition via Large-Scale Weak Supervision",2022,"2212.04356","3400","vis"],
  ["cai","Constitutional AI: Harmlessness from AI Feedback",2022,"2212.08073","1900","align"],
  ["llama","LLaMA: Open and Efficient Foundation Language Models",2023,"2302.13971","12000","arch"],
  ["toolformer","Toolformer: Language Models Can Teach Themselves to Use Tools",2023,"2302.04761","1500","reason"],
  ["hyena","Hyena Hierarchy: Towards Larger Convolutional Language Models",2023,"2302.10866","560","ssm"],
  ["gpt4","GPT-4 Technical Report",2023,"2303.08774","9500","arch"],
  ["lion","Symbolic Discovery of Optimization Algorithms (Lion)",2023,"2302.06675","640","opt"],
  ["starcoder","StarCoder: May the Source Be With You",2023,"2305.06161","880","arch"],
  ["lima","LIMA: Less Is More for Alignment",2023,"2305.11206","1100","align"],
  ["gqa","GQA: Training Generalized Multi-Query Transformer Models",2023,"2305.13245","900","eff"],
  ["rwkv","RWKV: Reinventing RNNs for the Transformer Era",2023,"2305.13048","560","ssm"],
  ["qlora","QLoRA: Efficient Finetuning of Quantized LLMs",2023,"2305.14314","3100","eff"],
  ["sophia","Sophia: A Scalable Stochastic Second-order Optimizer",2023,"2305.14342","280","opt"],
  ["dpo","Direct Preference Optimization",2023,"2305.18290","4200","align"],
  ["phi","Textbooks Are All You Need",2023,"2306.11644","900","arch"],
  ["flash2","FlashAttention-2: Faster Attention with Better Parallelism",2023,"2307.08691","1300","eff"],
  ["llama2","Llama 2: Open Foundation and Fine-Tuned Chat Models",2023,"2307.09288","13000","arch"],
  ["yarn","YaRN: Efficient Context Window Extension of LLMs",2023,"2309.00071","560","arch"],
  ["vllm","Efficient Memory Management for LLM Serving with PagedAttention",2023,"2309.06180","1500","eff"],
  ["streaming","Efficient Streaming Language Models with Attention Sinks",2023,"2309.17453","760","eff"],
  ["mistral","Mistral 7B",2023,"2310.06825","2600","arch"],
  ["ring","Ring Attention with Blockwise Transformers",2023,"2310.01889","400","eff"],
  ["mamba","Mamba: Linear-Time Sequence Modeling with Selective State Spaces",2023,"2312.00752","2400","ssm"],
  ["mixtral","Mixtral of Experts",2024,"2401.04088","1600","moe"],
  ["medusa","Medusa: Simple LLM Inference Acceleration Framework",2024,"2401.10774","390","eff"],
  ["olmo","OLMo: Accelerating the Science of Language Models",2024,"2402.00838","560","arch"],
  ["gemma","Gemma: Open Models Based on Gemini Research",2024,"2403.08295","1200","arch"],
  ["mod","Mixture-of-Depths: Dynamically Allocating Compute",2024,"2404.02258","230","moe"],
  ["dsv2","DeepSeek-V2: A Strong, Economical, Efficient MoE Language Model",2024,"2405.04434","640","moe"],
  ["qwen2","Qwen2 Technical Report",2024,"2407.10671","1100","arch"],
  ["llama3","The Llama 3 Herd of Models",2024,"2407.21783","3200","arch"],
  ["tulu","Tulu 3: Pushing Frontiers in Open Language Model Post-Training",2024,"2411.15124","310","align"],
  ["dsv3","DeepSeek-V3 Technical Report",2024,"2412.19437","1400","moe"],
  ["dsr1","DeepSeek-R1: Incentivizing Reasoning Capability via RL",2025,"2501.12948","2100","reason"]
];

// 모델 릴리스 노드 (기획안: tracker.json 을 외부 소스로 소비)
const MODELS = [
  ["m-dsv3","DeepSeek-V3","dsv3","MIT"],
  ["m-dsr1","DeepSeek-R1","dsr1","MIT"],
  ["m-mixtral","Mixtral 8x7B","mixtral","Apache-2.0"],
  ["m-llama3","Llama 3.1 405B","llama3","Llama Community"],
  ["m-qwen2","Qwen2.5 72B","qwen2","Apache-2.0"],
  ["m-mistral","Mistral 7B","mistral","Apache-2.0"],
  ["m-gemma","Gemma 2 27B","gemma","Gemma Terms"],
  ["m-olmo","OLMo 2 13B","olmo","Apache-2.0"]
];

// 아티클: 인용 그래프에 붙지 않는다. 의도적으로 고립 노드로 남긴다.
const ARTICLES = [
  ["a-kipply","Transformer Inference Arithmetic","kipply.github.io",2022],
  ["a-scale","How to Scale Your Model","jax-ml.github.io",2025],
  ["a-weng","Attention? Attention!","lilianweng.github.io",2018]
];

// from: 이 논문이 인용하는 논문들
const CITE_SRC = `
attention: bahdanau seq2seq lstm adam layernorm
bert: attention seq2seq adam
gpt2: attention bert layernorm
t5: attention bert adam
megatron: attention bert gpt2 adam
zero: megatron adam gpipe
gpipe: resnet seq2seq
mqa: attention
scaling: attention gpt2 adam
gpt3: attention bert gpt2 scaling t5
mmlu: gpt3 bert t5
dpr: bert attention
colbert: bert dpr attention
rag: dpr bert t5 attention
ddpm: resnet adam
moe: lstm adam
gshard: attention moe t5
switch: moe gshard attention t5 adam
expertchoice: switch gshard moe attention
vit: attention resnet bert
clip: vit attention resnet bert
ldm: ddpm clip vit attention
rope: attention bert
alibi: attention rope
lora: attention bert gpt3 adam
humaneval: gpt3 attention
gsm8k: gpt3 t5
s4: attention lstm
hyena: s4 attention gpt2
rwkv: attention lstm s4
mamba: s4 attention hyena rwkv
chinchilla: scaling gpt3 attention t5
cot: gpt3 t5 gsm8k
selfcons: cot gpt3 gsm8k
react: cot gpt3 selfcons
toolformer: gpt3 cot
rlhfsum: ppo gpt2
instructgpt: gpt3 ppo rlhfsum t5
cai: instructgpt rlhfsum ppo
dpo: instructgpt ppo rlhfsum gpt3
lima: llama instructgpt gpt3
flash: attention bert gpt3 megatron
flash2: flash attention megatron
gqa: mqa attention t5 flash
bigbench: gpt3 t5 mmlu bert
specdec: attention t5 gpt3
whisper: attention clip gpt2
gpt4: gpt3 instructgpt mmlu humaneval bigbench chinchilla
llama: attention rope scaling chinchilla gpt3 adam t5
llama2: llama attention rope gqa instructgpt ppo flash
mistral: llama llama2 flash gqa attention rope
starcoder: humaneval llama attention flash
phi: gpt3 humaneval gpt4
qlora: lora llama attention gpt3
lion: adam vit resnet
sophia: adam gpt2 chinchilla
yarn: rope alibi llama flash
vllm: attention flash gpt3 megatron llama
streaming: attention rope alibi flash llama2
ring: flash attention megatron
mixtral: mistral switch moe gshard llama2 attention
medusa: specdec vllm llama2 flash
olmo: llama2 attention t5 adam
gemma: llama2 attention rope gqa
mod: switch moe expertchoice attention
dsv2: switch gshard llama2 attention rope gqa mqa
qwen2: llama2 attention rope gqa dpo yarn
llama3: llama2 rope gqa flash2 chinchilla scaling dpo
tulu: dpo instructgpt llama2 llama3
dsv3: dsv2 mixtral switch gqa rope flash expertchoice chinchilla
dsr1: dsv3 ppo cot instructgpt gsm8k
`;
