import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const walletRequire = createRequire(import.meta.url);
const root = dirname(walletRequire.resolve('@artfi/task-listing-runtime/package.json'));
const require = createRequire(join(root, 'server.mjs'));
const { Interface, Network } = require('ethers');
const { OpenSeaAPI, OpenSeaSDK, Chain, getDefaultConduit } = require('@opensea/sdk');
const { SeaportABI } = require('@opensea/seaport-js/lib/abi/Seaport');
const { ReadOnlyNftProvider } = require(join(root,'dist/apps/web/src/lib/nft/recorder.js'));
const { NftError } = require(join(root,'dist/apps/web/src/lib/nft/model.js'));
const { components, orderHash, sdkChain } = require(join(root,'dist/apps/web/src/lib/nft/validation.js'));
const { kernelRequestDigest } = await import(pathToFileURL(join(root,'dist/scripts/agent/agent-kernel.mjs')));
const seller = "0x1111111111111111111111111111111111111111";
const nft = "0x2222222222222222222222222222222222222222";
const fee = "0x3333333333333333333333333333333333333333";
const scope = {
    slug: "synthetic-digital",
    chain: "ethereum",
    contract: nft,
    standard: "erc1155",
    label: "Synthetic only",
    charity: false
};
const abi = new Interface([
    ...SeaportABI,
    "function balanceOf(address,uint256) view returns(uint256)",
    "function ownerOf(uint256) view returns(address)",
    "function isApprovedForAll(address,address) view returns(bool)",
    "function getApproved(uint256) view returns(address)",
    "function isValidSignature(bytes32,bytes) view returns(bytes4)"
]);
export function createNativeFixture() {
    const store = new Map();
    const state = {
        scope: structuredClone(scope),
        approved: true,
        tokenApproved: false,
        balance: 1000000n,
        counter: 0n,
        owner: seller,
        code: "0x01",
        validSignature: true,
        offline: false,
        wrongHash: false,
        visible: false,
        posts: 0,
        writes: [],
        rpc: [],
        authorizeAfterRead: undefined,
        beforeSubmitted: undefined,
        loseReviewResponse: false
    };
    const request = {
        action: "list",
        account: seller,
        collection: scope.slug,
        tokenId: "7",
        quantity: "10",
        priceWei: "1000000000000000000",
        expiresAt: Math.floor(Date.now() / 1000) + 3600
    };
    class SyntheticProvider extends ReadOnlyNftProvider {
        constructor(){
            super("http://127.0.0.1:1", undefined, {
                cacheTimeout: -1
            });
        }
        async getNetwork() {
            return Network.from(1);
        }
        async send(method, args) {
            state.rpc.push(method);
            if (method === "eth_chainId") return "0x1";
            if (method === "eth_getCode") return state.code;
            if (method === "eth_call") {
                const tx = args[0];
                const call = abi.parseTransaction(tx);
                if (!call) throw Error("Unmodeled synthetic read");
                const result = {
                    balanceOf: [
                        state.balance
                    ],
                    ownerOf: [
                        state.owner
                    ],
                    getCounter: [
                        state.counter
                    ],
                    getOrderStatus: [
                        false,
                        false,
                        0n,
                        0n
                    ],
                    isApprovedForAll: [
                        state.approved
                    ],
                    getApproved: [
                        state.tokenApproved ? getDefaultConduit(Chain.Mainnet).address : `0x${"0".repeat(40)}`
                    ],
                    isValidSignature: [
                        state.validSignature && call.name === "isValidSignature" && call.args[1] === "0x1234" ? "0x1626ba7e" : "0xffffffff"
                    ]
                };
                if (!result[call.name]) throw Error(`Unmodeled synthetic read ${call.name}`);
                const output = abi.encodeFunctionResult(call.fragment, result[call.name]);
                state.authorizeAfterRead?.();
                return output;
            }
            throw Error(`NETWORK FORBIDDEN: ${method}`);
        }
    }
    const fetch = async (input, init)=>{
        const url = new URL(String(input));
        if (init?.method === "POST") {
            assert.equal(state.writes.at(-1)?.status, "submitted");
            state.posts++;
            if (state.offline) throw Error("Synthetic lost response");
            const payload = JSON.parse(String(init.body));
            return Response.json({
                order_hash: state.wrongHash ? `0x${"9".repeat(64)}` : orderHash(components(payload.parameters)),
                protocol_data: {
                    parameters: payload.parameters
                }
            });
        }
        if (url.pathname.startsWith("/api/v2/orders/")) {
            if (!state.visible) throw Error("Synthetic order not observed");
            const plan = [
                ...store.values()
            ][0].plan;
            return Response.json({
                order: {
                    order_hash: plan.orderHash,
                    protocol_data: {
                        parameters: plan.typedData.message
                    }
                }
            });
        }
        if (url.pathname === "/api/v2/chains") return Response.json({
            chains: [
                {
                    chain: "ethereum"
                }
            ]
        });
        if (url.pathname.includes("/nfts/")) return Response.json({
            nft: {
                identifier: "7",
                collection: scope.slug,
                contract: nft,
                token_standard: state.scope.standard,
                name: "Synthetic only"
            }
        });
        if (url.pathname === `/api/v2/collections/${scope.slug}`) return Response.json({
            collection: scope.slug,
            name: "Synthetic only",
            fees: [
                {
                    fee: 2.5,
                    recipient: fee,
                    required: true
                }
            ],
            contracts: [
                {
                    address: nft,
                    chain: "ethereum"
                }
            ]
        });
        throw Error(`Unmodeled synthetic SDK path ${url.pathname}`);
    };
    const deps = {
        requireTrading: ()=>{},
        scope: ()=>state.scope,
        provider: ()=>new SyntheticProvider(),
        sdk: (recorder, selected)=>new OpenSeaSDK(recorder, {
                chain: sdkChain(selected),
                fetch,
                apiKey: "synthetic-no-credential"
            }, ()=>{}),
        api: (selected)=>new OpenSeaAPI({
                chain: sdkChain(selected),
                fetch,
                apiKey: "synthetic-no-credential"
            }),
    };
    return { state, store, request, deps };
}

/** Local encrypted fixture journal, deliberately NOT an HTTP/session transport. */
export function installDurableFixtureJournal(f, journalStore) {
  f.deps.journal = async (principal, action, record) => {
    assert.equal(principal.kind, 'task');
    assert.equal(record.plan?.sessionId, undefined);
    const key = `synthetic-native:${record.id}`;
    const exactPrincipal = r => {
      if (!r || kernelRequestDigest(r.plan.taskPrincipal) !== kernelRequestDigest(principal)) throw new NftError(403, 'SYNTHETIC_JOURNAL_PRINCIPAL_REFUSED');
    };
    if (action === 'get') {
      const r = (await journalStore.readMany([key]))[key];
      if (!r) throw new NftError(404, 'Synthetic missing'); exactPrincipal(r);
      f.store.set(r.id, structuredClone(r)); return r;
    }
    if (record.status === 'submitted') await f.state.beforeSubmitted?.();
    const result = await journalStore.transactionMany([key], values => {
      const current = values[key], next = structuredClone(record); exactPrincipal(next);
      if (current) exactPrincipal(current);
      if (JSON.stringify(next).includes('"signature":')) throw Error('SIGNATURE LEAK');
      if (action === 'create' && current) {
        if (next.requestHash !== current.requestHash) throw new NftError(409,'SYNTHETIC_JOURNAL_CREATE_CONFLICT');
        return { [key]: current };
      }
      if (action === 'update' && (!current || current.revision !== next.revision || kernelRequestDigest(current.plan) !== kernelRequestDigest(next.plan))) throw new NftError(409,'SYNTHETIC_JOURNAL_CAS_CONFLICT');
      next.revision = current ? current.revision + 1 : 1; next.updatedAt = new Date().toISOString(); next.walletStarted = Boolean(next.walletStarted);
      return { [key]: next };
    });
    const saved = result[key]; f.store.set(saved.id, structuredClone(saved)); f.state.writes.push(structuredClone(saved));
    if (f.state.loseReviewResponse && saved.walletStarted && saved.status === 'awaiting-wallet') {
      f.state.loseReviewResponse = false; throw new NftError(503, 'Synthetic lost review response after durable claim');
    }
    return saved;
  };
}
