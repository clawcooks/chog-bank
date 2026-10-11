export const CHAINS = {
  10143: {
    chainIdHex: "0x279f",
    chainName: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: ["https://testnet-rpc.monad.xyz"],
    blockExplorerUrls: ["https://testnet.monadexplorer.com"],
  },
  31337: {
    chainIdHex: "0x7a69",
    chainName: "Local Hardhat",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: ["http://127.0.0.1:8545"],
    blockExplorerUrls: [],
  },
};

export async function ensureChain(ethereum, targetChainId) {
  const target = CHAINS[targetChainId];
  if (!target) return;

  const currentChainId = await ethereum.request({ method: "eth_chainId" });
  if (currentChainId === target.chainIdHex) return;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target.chainIdHex }],
    });
  } catch (err) {
    if (err.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: target.chainIdHex,
            chainName: target.chainName,
            nativeCurrency: target.nativeCurrency,
            rpcUrls: target.rpcUrls,
            blockExplorerUrls: target.blockExplorerUrls,
          },
        ],
      });
    } else {
      throw err;
    }
  }
}
