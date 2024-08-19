// Migrations are an early feature. Currently, they're nothing more than this
// single deploy script that's invoked from the CLI, injecting a provider
// configured from the workspace's Anchor.toml.

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Giftsol } from "../target/types/giftsol";

const program = anchor.workspace.Giftsol as Program<Giftsol>;

module.exports = async function (provider) {
  // Configure client to use the provider.
  anchor.setProvider(provider);

  // Add your deploy script here.

  const tx = await program.methods
    .initialize()
    .accountsPartial({
      globalState: await getGlobalStatePda(),
      admin: provider.wallet.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  console.log("Program initialized");
  console.log(tx);
};

async function getGlobalStatePda(): Promise<anchor.web3.PublicKey> {
  const [globalStatePda] = await anchor.web3.PublicKey.findProgramAddress(
    [Buffer.from("global_state")],
    program.programId
  );
  return globalStatePda;
}
