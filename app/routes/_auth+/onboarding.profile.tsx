import { conform, useForm } from '@conform-to/react'
import { getFieldsetConstraint, parse } from '@conform-to/zod'
import {
	json,
	redirect,
	type LoaderFunctionArgs,
	type ActionFunctionArgs,
	type MetaFunction,
} from '@remix-run/node'
import {
	Form,
	useActionData,
	useLoaderData,
	useSearchParams,
} from '@remix-run/react'
import { AuthenticityTokenInput } from 'remix-utils/csrf/react'
import { HoneypotInputs } from 'remix-utils/honeypot/react'
import { z } from 'zod'
import { CheckboxField, ErrorList, Field } from '#app/components/forms.tsx'
import { Spacer } from '#app/components/spacer.tsx'
import { StatusButton } from '#app/components/ui/status-button.tsx'
import { requireAnonymous, sessionKey, signup } from '#app/utils/auth.server.ts'
import { validateCSRF } from '#app/utils/csrf.server.ts'
import { checkHoneypot } from '#app/utils/honeypot.server.ts'
import { useIsPending } from '#app/utils/misc.tsx'
import { authSessionStorage } from '#app/utils/session.server.ts'
import {
	NameSchema,
	PasswordAndConfirmPasswordSchema,
} from '#app/utils/user-validation.ts'
import { verifySessionStorage } from '#app/utils/verification.server.ts'
import { onboardingEmailSessionKey } from './onboarding.index'

const SignupFormSchema = z
	.object({
		firstName: NameSchema,
		lastName: NameSchema,
		remember: z.boolean().optional(),
		redirectTo: z.string().optional(),
	})
	.and(PasswordAndConfirmPasswordSchema)

async function requireOnboardingEmail(request: Request) {
	await requireAnonymous(request)
	const verifySession = await verifySessionStorage.getSession(
		request.headers.get('cookie'),
	)
	const email = verifySession.get(onboardingEmailSessionKey)
	if (typeof email !== 'string' || !email) {
		throw redirect('/signup')
	}
	return email
}
export async function loader({ request }: LoaderFunctionArgs) {
	const email = await requireOnboardingEmail(request)
	return json({ email })
}

export async function action({ request }: ActionFunctionArgs) {
	const email = await requireOnboardingEmail(request)
	const formData = await request.formData()
	await validateCSRF(formData, request.headers)
	checkHoneypot(formData)
	const submission = await parse(formData, {
		schema: intent =>
			SignupFormSchema.transform(async data => {
				if (intent !== 'submit') return { ...data, session: null }

				const session = await signup({ ...data, email })
				return { ...data, session }
			}),
		async: true,
	})

	if (submission.intent !== 'submit') {
		return json({ status: 'idle', submission } as const)
	}
	if (!submission.value?.session) {
		return json({ status: 'error', submission } as const, { status: 400 })
	}

	const { session, remember, redirectTo } = submission.value

	const authSession = await authSessionStorage.getSession(
		request.headers.get('cookie'),
	)
	authSession.set(sessionKey, session.id)
	const verifySession = await verifySessionStorage.getSession()
	const headers = new Headers()
	headers.append(
		'set-cookie',
		await authSessionStorage.commitSession(authSession, {
			expires: remember ? session.expirationDate : undefined,
		}),
	)
	headers.append(
		'set-cookie',
		await verifySessionStorage.destroySession(verifySession),
	)

	const redirectToParam = redirectTo ? `?redirectTo=${redirectTo}` : ''
	return redirect(`/onboarding/company${redirectToParam}`, { headers })
}

export const meta: MetaFunction = () => {
	return [{ title: 'Set up TruckLink Account' }]
}

export default function SignupRoute() {
	const data = useLoaderData<typeof loader>()
	const actionData = useActionData<typeof action>()
	const isPending = useIsPending()
	const [searchParams] = useSearchParams()
	const redirectTo = searchParams.get('redirectTo')

	const [form, fields] = useForm({
		id: 'onboarding-form',
		constraint: getFieldsetConstraint(SignupFormSchema),
		defaultValue: { redirectTo },
		lastSubmission: actionData?.submission,
		onValidate({ formData }) {
			return parse(formData, { schema: SignupFormSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<div className="container flex min-h-full flex-col justify-center pb-32 pt-20">
			<div className="mx-auto w-full max-w-lg">
				<div className="flex flex-col gap-3 text-center">
					<h1 className="text-h1">Welcome aboard {data.email}!</h1>
					<p className="text-body-md text-muted-foreground">
						Please enter your details.
					</p>
				</div>
				<Spacer size="xs" />
				<Form
					method="POST"
					className="mx-auto min-w-full max-w-sm sm:min-w-[368px]"
					{...form.props}
				>
					<AuthenticityTokenInput />
					<HoneypotInputs />
					<Field
						labelProps={{
							htmlFor: fields.firstName.id,
							children: 'First Name',
						}}
						inputProps={{
							...conform.input(fields.firstName),
							autoComplete: 'given-name',
							className: 'capitalize',
						}}
						errors={fields.firstName.errors}
					/>
					<Field
						labelProps={{
							htmlFor: fields.lastName.id,
							children: 'Last Name',
						}}
						inputProps={{
							...conform.input(fields.lastName),
							autoComplete: 'family-name',
							className: 'capitalize',
						}}
						errors={fields.lastName.errors}
					/>
					<Field
						labelProps={{ htmlFor: fields.password.id, children: 'Password' }}
						inputProps={{
							...conform.input(fields.password, { type: 'password' }),
							autoComplete: 'new-password',
						}}
						errors={fields.password.errors}
					/>

					<Field
						labelProps={{
							htmlFor: fields.confirmPassword.id,
							children: 'Confirm Password',
						}}
						inputProps={{
							...conform.input(fields.confirmPassword, { type: 'password' }),
							autoComplete: 'new-password',
						}}
						errors={fields.confirmPassword.errors}
					/>

					<CheckboxField
						labelProps={{
							htmlFor: fields.remember.id,
							children: 'Remember me',
						}}
						buttonProps={conform.input(fields.remember, { type: 'checkbox' })}
						errors={fields.remember.errors}
					/>

					<input {...conform.input(fields.redirectTo, { type: 'hidden' })} />
					<ErrorList errors={form.errors} id={form.errorId} />

					<div className="flex items-center justify-between gap-6">
						<StatusButton
							className="w-full"
							status={isPending ? 'pending' : actionData?.status ?? 'idle'}
							type="submit"
							disabled={isPending}
						>
							Create an account
						</StatusButton>
					</div>
				</Form>
			</div>
		</div>
	)
}
