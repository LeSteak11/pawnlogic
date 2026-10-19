"""Backports for the older PyTorch that Intel Macs are limited to (2.2.2).

Maia-3 imports torch.nn.RMSNorm, added in torch 2.4. Newer torch is left untouched.
"""
import torch
from torch import nn


class RMSNorm(nn.Module):
    """Same parameters, state-dict keys and maths as torch.nn.RMSNorm."""

    def __init__(self, normalized_shape, eps=None, elementwise_affine=True, device=None, dtype=None):
        super().__init__()
        if isinstance(normalized_shape, int):
            normalized_shape = (normalized_shape,)
        self.normalized_shape = tuple(normalized_shape)
        self.eps = eps
        self.elementwise_affine = elementwise_affine
        if elementwise_affine:
            self.weight = nn.Parameter(torch.ones(self.normalized_shape, device=device, dtype=dtype))
        else:
            self.register_parameter("weight", None)

    def forward(self, x):
        eps = self.eps if self.eps is not None else torch.finfo(x.dtype).eps
        dims = tuple(range(-len(self.normalized_shape), 0))
        x = x * torch.rsqrt(x.pow(2).mean(dim=dims, keepdim=True) + eps)
        return x * self.weight if self.weight is not None else x


def install():
    if not hasattr(nn, "RMSNorm"):
        nn.RMSNorm = RMSNorm
