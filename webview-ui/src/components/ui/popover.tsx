import * as React from "react"
import { PortalProps } from "@radix-ui/react-portal"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"

const Popover = PopoverPrimitive.Root

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
	React.ElementRef<typeof PopoverPrimitive.Content>,
	React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content> & Pick<PortalProps, "container">
>(({ className, align = "center", sideOffset = 4, container, ...props }, ref) => (
	<PopoverPrimitive.Portal container={container}>
		<PopoverPrimitive.Content
			ref={ref}
			data-slot="popover-content"
			align={align}
			sideOffset={sideOffset}
			className={cn(
				"z-50 w-72 p-4 outline-none",
				"bg-popover",
				"border border-vscode-focusBorder",
				"text-popover-foreground",
				className,
			)}
			{...props}
		/>
	</PopoverPrimitive.Portal>
))
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
