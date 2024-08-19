use anchor_lang::prelude::*;
use anchor_lang::system_program::transfer;
use anchor_lang::system_program::Transfer;

declare_id!("95tdskrYsT3f2eCQAh9GUkrZWFo8rTM8aob1BhYcCFFS");


#[program]
pub mod giftsol {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.init(2, ctx.accounts.admin.key(), &ctx.bumps)?;
        Ok(())
    }

    pub fn update_fee_settings(ctx: Context<UpdateFeeSettings>, fee_percentage: u8, fee_receiver: Pubkey) -> Result<()> {
        if ctx.accounts.admin.key() != ctx.accounts.global_state.admin {
            return Err(GiftError::Unauthorized.into());
        }
        ctx.accounts.update_fee_settings(fee_percentage, fee_receiver)?;
        Ok(())
    }

    pub fn create_giftcard(
        ctx: Context<CouponCreate>,
        seed: u64,
        coupon_code: String,
        amount: u64,
    ) -> Result<()> {
        let hashed_coupon_code = custom_hash(&coupon_code);
        ctx.accounts
            .create_giftcard(seed, hashed_coupon_code, amount, &ctx.bumps)?;
        Ok(())
    }

    pub fn avail(ctx: Context<CouponWithdraw>, coupon_code: String) -> Result<()> {
        let hashed_coupon_code = custom_hash(&coupon_code);
        ctx.accounts.withdraw(hashed_coupon_code)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        seeds = [b"global_state"],
        space = GlobalState::INIT_SPACE,
        bump,
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl <'info> Initialize<'info> {
    pub fn init(&mut self, fee_percentage: u8, fee_receiver: Pubkey, bumps:&InitializeBumps) -> Result<()> {
        self.global_state.set_inner(GlobalState {
            admin: self.admin.key(),
            fee_percentage,
            fee_receiver,
            bump: bumps.global_state,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct UpdateFeeSettings<'info> {
    #[account(
        mut,
        seeds = [b"global_state"],
        bump = global_state.bump,
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> UpdateFeeSettings<'info> {
    pub fn update_fee_settings(&mut self, fee_percentage: u8, fee_receiver: Pubkey) -> Result<()> {
        self.global_state.fee_percentage = fee_percentage;
        self.global_state.fee_receiver = fee_receiver;
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CouponCreate<'info> {
    #[account(
        init, 
        payer = creator, 
        seeds = [b"giftcard", creator.key().as_ref(), seed.to_le_bytes().as_ref()],
        space = GiftCard::INIT_SPACE,
        bump,
    )]
    pub giftcard: Account<'info, GiftCard>,
    #[account(
        mut,
        seeds = [b"global_state"],
        bump = global_state.bump,
    )]
    pub global_state: Account<'info, GlobalState>,
    /// CHECK: This account is the fee receiver defined in the global state. 
    /// We trust this account to receive the fees, and therefore, no additional checks are required.
    #[account(mut, address = global_state.fee_receiver)]
    pub fee_receiver: AccountInfo<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CouponCreate<'info> {
    pub fn create_giftcard(
        &mut self,
        seed: u64,
        hashed_coupon_code: [u8; 32],
        amount: u64,
        bumps: &CouponCreateBumps,
    ) -> Result<()> {

        if amount <= 0 {
            return Err(GiftError::InsufficientAmmount.into());
        }

        self.giftcard.set_inner(GiftCard {
            seed,
            creator: self.creator.key(),
            hashed_coupon_code, // TODO: add hashing
            amount,
            bump: bumps.giftcard,
        });

        let fee_amount = amount * u64::from(self.global_state.fee_percentage) / 100;
        let amount_after_fee = amount - fee_amount;

        // Transfer the fee to the fee receiver
        let cpi_program = self.system_program.to_account_info();
        let cpi_accounts_fee = Transfer {
            from: self.creator.to_account_info(),
            to: self.fee_receiver.to_account_info(),
        };
        let cpi_ctx_fee = CpiContext::new(cpi_program, cpi_accounts_fee);
        transfer(cpi_ctx_fee, fee_amount)?;

        let cpi_program = self.system_program.to_account_info();

        let cpi_accounts = Transfer {
            from: self.creator.to_account_info(),
            to: self.giftcard.to_account_info(),
        };

        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);

        transfer(cpi_ctx, amount_after_fee)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CouponWithdraw<'info> {
    #[account(
        mut,
        close = claimer, 
        seeds = [b"giftcard", giftcard.creator.key().as_ref(), giftcard.seed.to_le_bytes().as_ref()],
        bump = giftcard.bump,
    )]
    pub giftcard: Account<'info, GiftCard>,
    #[account(mut)]
    pub claimer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

impl<'info> CouponWithdraw<'info> {
    pub fn withdraw(&mut self, hashed_coupon_code: [u8; 32]) -> Result<()> {
        if self.giftcard.hashed_coupon_code != hashed_coupon_code {
            return Err(GiftError::InvalidCouponCode.into());
        }
        Ok(())
    }
}

#[account]
pub struct GiftCard {
    pub seed: u64,
    pub creator: Pubkey,
    pub hashed_coupon_code: [u8; 32],
    pub amount: u64,
    pub bump: u8,
}

impl Space for GiftCard {
    const INIT_SPACE: usize = 8 + 8 + 32 + 32 + 8 + 1;
}

#[error_code]
pub enum GiftError {
    #[msg("Invalid Coupon Code")]
    InvalidCouponCode,
    #[msg{"Insufficient Amount"}]
    InsufficientAmmount,
    #[msg("Unauthorized")]
    Unauthorized,
}

fn custom_hash(input: &str) -> [u8; 32] {
    let mut output = [0u8; 32];
    let input_bytes = input.as_bytes();

    for (i, byte) in input_bytes.iter().enumerate() {
        output[i % 32] ^= byte;
    }

    output
}

#[account]
pub struct GlobalState {
    pub admin: Pubkey,
    pub fee_percentage: u8,
    pub fee_receiver: Pubkey,
    pub bump: u8,
}

impl Space for GlobalState {
    const INIT_SPACE: usize = 8 + 32 + 1 + 32 + 1;
}
