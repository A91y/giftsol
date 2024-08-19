// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import path from "path";
import fs from "fs";

// Load the IDL (Interface Description Language) for the program
const idl = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../target/idl/giftsol.json"), "utf8")
);

module.exports = async function (provider: anchor.AnchorProvider) {
  // Configure client to use the provider.
  console.log("RPC: ", provider.connection.rpcEndpoint);
  anchor.setProvider(provider);
  console.log("Deploying the program");

  // Add your deploy script here.
  const program = new anchor.Program(idl, provider);
  await program.methods
    .initialize()
    .accountsPartial({
      globalState: await getGlobalStatePda(),
      admin: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc()
    .then((res) => {
      console.log("Program initialized");
      console.log(res);
    })
    .catch((err) => {
      console.log(err);
      throw new Error("Program initialization failed");
    });

  async function getGlobalStatePda(): Promise<anchor.web3.PublicKey> {
    console.log("Getting global state PDA");
    let globalStatePda: anchor.web3.PublicKey;
    [globalStatePda] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("global_state")],
      program.programId
    );
    console.log("Global state PDA: ", globalStatePda.toBase58());
    return globalStatePda;
  }
};
